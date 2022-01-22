const fetch = require('node-fetch')
const cheerio = require('cheerio')
const postcode = process.argv[2]

const query = `
query CheckAvailability($carModel: String!, $postcode: String!) {
  getCarAvailability(carModel: $carModel, postcode: $postcode) {
    date
    colours
    __typename
  }
}

`

const createCsvWriter = require('csv-writer').createObjectCsvWriter
const csvPath = `output/${postcode}.csv`
const csvWriter = createCsvWriter({
  path: csvPath,
  header: [
    { id: 'model', title: 'Model' },
    { id: 'trim', title: 'Trim' },
    { id: 'price', title: 'Price' },
    { id: 'link', title: 'Link' },
    { id: 'date', title: 'Date' },
    { id: 'colors', title: 'Colors' },
    { id: 'sniffTimestamp', title: 'SniffTimestamp' }
  ]
})

const getModelAvailability = async function (modelNumber, modelSlug) {
  /* eslint-disable no-useless-escape */
  const variables = `
{
  "carModel": ${modelNumber},
  "postcode": \"${postcode}\"
}
`
  /* eslint-enable no-useless-escape */

  console.log(variables)
  const availabilityRes = await fetch('https://my.on.to/api/graphql/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query, variables })
  })
  const availabilityData = await availabilityRes.json()
  const getCarAvailabilityData = availabilityData.data.getCarAvailability

  console.log(
    `Found: ${getCarAvailabilityData.length} for model number: ${modelNumber}`
  )
  models[modelSlug].availability = getCarAvailabilityData
}

const models = {}
const availableCarDates = []
const getModels = async function () {
  const modelListRes = await fetch('https://on.to/electric-cars')
  const modelListHtml = await modelListRes.text()
  const $ = cheerio.load(modelListHtml)
  $('a').each(function (i, elm) {
    const modelLink = $(elm).attr('href')
    if (modelLink.startsWith('/electric-cars/')) {
      const modelSlug = modelLink.split('/')[2]
      models[modelSlug] = {}
    }
  })
  console.log(models)
  for (const modelSlug of Object.keys(models)) {
    await getModel(modelSlug)
  }
  for (const modelSlug of Object.keys(models)) {
    await getModelAvailability(models[modelSlug].modelNumber, modelSlug)
  }
  for (const modelSlug of Object.keys(models)) {
    const model = models[modelSlug]
    if (model.availability.length) {
      model.availability.forEach(function (availability) {
        const date = new Date()
        const sniffTimestamp =
          date.getFullYear() +
          ('0' + (date.getMonth() + 1)).slice(-2) +
          ('0' + date.getDate()).slice(-2) +
          ('0' + date.getHours()).slice(-2) +
          ('0' + date.getMinutes()).slice(-2) +
          ('0' + date.getSeconds()).slice(-2)

        availableCarDates.push({
          model: model.name,
          trim: model.trim,
          price: model.price,
          link: model.link,
          date: availability.date,
          colors: availability.colours.join('/'),
          sniffTimestamp: sniffTimestamp
        })
      })
    }
  }

  await csvWriter.writeRecords(availableCarDates)
  console.log(
    `All done :), check ${csvPath} for results. Found: ${availableCarDates.length} car/dates`
  )
}

const getModel = async function (modelSlug) {
  console.log(`Fetching full model data for model: ${modelSlug}`)
  models[modelSlug].link = `https://on.to/electric-cars/${modelSlug}`
  console.log(`Fetching model page HTML: ${modelSlug}`)
  const modelPageRes = await fetch(models[modelSlug].link)
  const modelPageHtml = await modelPageRes.text()
  const $ = cheerio.load(modelPageHtml)

  models[modelSlug].name = $('h1').text()

  console.log(`Fetching model page JSON: ${modelSlug}`)
  models[
    modelSlug
  ].jsonLink = `https://on.to/page-data/electric-cars/${modelSlug}/page-data.json`
  const modelJsonRes = await fetch(models[modelSlug].jsonLink)
  const modelJson = await modelJsonRes.json()
  models[modelSlug].modelNumber = modelJson.result.data.carModel.pk
  models[modelSlug].trim = modelJson.result.data.prismicCar.data.trim
  models[modelSlug].price = modelJson.result.data.prismicCar.data.price
}
getModels()
