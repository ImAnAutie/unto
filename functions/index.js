const functions = require("firebase-functions");


const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
initializeApp();
const db = getFirestore();
const cors = require("cors")({origin: true});


const fetch = require("node-fetch");
const cheerio = require("cheerio");


const getModelAvailability = async function(model, postcode) {
  const modelNumber = model.modelNumber;

  const query = `
query CheckAvailability($carModel: String!, $postcode: String!) {
  getCarAvailability(carModel: $carModel, postcode: $postcode) {
    date
    colours
    __typename
  }
}
`;
  /* eslint-disable no-useless-escape */
  const variables = `
  {
    "carModel": ${modelNumber},
    "postcode": \"${postcode}\"
  }
  `;
  /* eslint-enable no-useless-escape */

  console.log(variables);
  const availabilityRes = await fetch("https://my.on.to/api/graphql/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({query, variables}),
  });
  try {
    const availabilityData = await availabilityRes.json();
    const getCarAvailabilityData = availabilityData.data.getCarAvailability;

    console.log(
        `Found: ${getCarAvailabilityData.length} 
        for model number: ${modelNumber}`,
    );
    model.availability = [];
    for (const availability of getCarAvailabilityData) {
      for (const availabilityColour of availability.colours) {
        model.availability.push({
          date: availability.date,
          colour: availabilityColour,
        });
      }
    }
    return model;
  } catch (err) {
    console.error(err);
    model.availability = [];
    return model;
  }
};

exports.searchPostcode = functions.https.onRequest(async function(req, res) {
  return cors(req, res, async () => {
    const postcode = req.query.postcode;
    const modelDocs = await db.collection("models").get();
    const models = modelDocs.docs.map((doc) => doc.data());
    const modelPromises = [];
    for (const model of models) {
      modelPromises.push(getModelAvailability(model, postcode));
    }
    let modelResults = await Promise.all(modelPromises);
    modelResults = modelResults.filter(function(modelResult) {
      return modelResult.availability.length > 0;
    });
    const results = [];
    for (const model of modelResults) {
      for (const availability of model.availability) {
        results.push({
          slug: model.slug,
          name: model.name,
          price: model.price,
          trim: model.trim,
          date: availability.date,
          colour: availability.colour,
          joinLink: `https://join.on.to/delivery-details?car-model=${model.slug}&car-model-id=${model.modelNumber}&date=${availability.date}&colour=${encodeURIComponent(availability.colour)}&postcode=${encodeURIComponent(postcode)}`,
        });
      }
    }

    return res.send({
      status: true,
      message: "Model results in modelResults field",
      results: results,
    });
  });
});


exports.logClick = functions.https.onRequest(async function(req, res) {
  return cors(req, res, async () => {
    await db.collection("clicks").add({
      timestamp: new Date(),
      slug: req.query.slug,
      colour: req.query.colour,
    });
    return res.send({
      status: true,
      message: "Logged click",
    });
  });
});

const getModel = async function(modelSlug) {
  console.log(`Fetching full model data for model: ${modelSlug}`);
  const model = {};
  model.link = `https://on.to/electric-cars/${modelSlug}`;
  console.log(`Fetching model page HTML: ${modelSlug}`);
  const modelPageRes = await fetch(model.link);
  const modelPageHtml = await modelPageRes.text();
  const $ = cheerio.load(modelPageHtml);

  model.name = $("h1").text();

  console.log(`Fetching model page JSON: ${modelSlug}`);
  model.jsonLink = `https://on.to/page-data/electric-cars/${modelSlug}/page-data.json`;
  const modelJsonRes = await fetch(model.jsonLink);
  const modelJson = await modelJsonRes.json();
  const modelData = modelJson.result.data;
  const prismicCar = modelData.prismicCar.data;
  model.modelNumber = modelData.carModel.pk;
  model.trim = prismicCar.trim;
  model.price = prismicCar.price;
  model.images = prismicCar.image_gallery.map((imgData) => imgData.image.url);
  model.slug = modelSlug;
  return model;
};


/** Bulk delete all docs in collection
 *
 * @param {objct} db - firestore db
 * @param {string} collectionPath - collection name
 * @param {number} batchSize - Docs per match
  */
async function deleteCollection(db, collectionPath, batchSize) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy("__name__").limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}


/** Delete in batch
 *
 * @param {object} db - firestore db
 * @param {string} query to delete
 * @param {function} resolve - resolve function
  */
async function deleteQueryBatch(db, query, resolve) {
  const snapshot = await query.get();

  const batchSize = snapshot.size;
  if (batchSize === 0) {
    // When there are no documents left, we are done
    resolve();
    return;
  }

  // Delete documents in a batch
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  // Recurse on the next process tick, to avoid
  // exploding the stack.
  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}
exports.updateModels = functions.https.onRequest(async function(req, res) {
  if (req.query.adminKey !== functions.config().unto.admin) {
    return res.status(403).send({

      status: false,
      message: "Invalid admin key",
    });
  }


  const modelListRes = await fetch("https://on.to/electric-cars");
  const modelListHtml = await modelListRes.text();
  const $ = cheerio.load(modelListHtml);
  const models = {};
  $("a").each(function(i, elm) {
    const modelLink = $(elm).attr("href");
    if (modelLink.startsWith("/electric-cars/")) {
      const modelSlug = modelLink.split("/")[2];
      console.log(`Found model ${modelSlug}`);
      models[modelSlug] = {slug: modelSlug};
    }
  });
  deleteCollection(db, "models", 100);
  for (const modelSlug of Object.keys(models)) {
    models[modelSlug] = await getModel(modelSlug);
    models[modelSlug].slug = modelSlug;
    console.log(models[modelSlug].images);
    await db.collection("models").add(models[modelSlug]);
  }
  return res.send({
    status: false,
    message: "Not implemented yet-admin key valid",
    models: models,
  });
});
