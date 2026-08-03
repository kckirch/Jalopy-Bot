const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const { scrapeWithHttp } = require('../src/scraping/httpInventoryScrape');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  createRouteHttpClient,
  createScrapeConfig,
  inventoryPage,
  ok,
} = require('../test-support/httpInventoryScrapeHarness');

test('http scraper does not log inactive reconciliation error details', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-file';
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({ yardOptions: ['1020'] }),
    'POST /': inventoryPage({
      yardOptions: ['1020'],
      rows: [{ year: 2005, make: 'TOYOTA', model: 'CAMRY', rowNumber: 11 }],
    }),
  });

  const consoleCalls = await captureConsole(async () => {
    await scrapeWithHttp(createScrapeConfig({ make: 'TOYOTA', model: 'CAMRY' }), {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async () => {},
      markInactiveVehicles: async () => {
        throw new TypeError(privateErrorDetails);
      },
    });
  });

  assert.match(joinedConsoleText(consoleCalls), /Error during inactive reconciliation: TypeError/);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('http scraper falls back to make options from HTML when GetMakes endpoint fails', async () => {
  const upserts = [];
  let getMakesAttempts = 0;
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({
      yardOptions: ['1020'],
      makeOptions: ['TOYOTA'],
      modelOptions: ['CAMRY'],
    }),
    'POST /Home/GetMakes': () => {
      getMakesAttempts += 1;
      throw new Error('simulated GetMakes failure');
    },
    'POST /Home/GetModels': () => {
      throw new Error('simulated GetModels failure');
    },
    'POST /': ({ payload }) => {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const rows =
        make === 'TOYOTA'
          ? [{ year: 2008, make: 'TOYOTA', model: 'CAMRY', rowNumber: 31 }]
          : [];
      return inventoryPage({
        yardOptions: ['1020'],
        makeOptions: ['TOYOTA'],
        rows,
      });
    },
  });

  await scrapeWithHttp(createScrapeConfig({ shouldMarkInactive: false }), {
    cheerio,
    httpClient,
    insertOrUpdateVehicle: async (...args) => upserts.push(args),
    markInactiveVehicles: async () => {},
  });

  assert.equal(getMakesAttempts, 1);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][1], 'TOYOTA');
  assert.equal(upserts[0][2], 'CAMRY');
});

test('http scraper continues across makes when one make model lookup fails and skips inactive reconciliation', async () => {
  const upserts = [];
  const markCalls = [];
  const rowsBySearch = new Map([
    ['TOYOTA|', [{ year: 2008, make: 'TOYOTA', model: 'CAMRY', rowNumber: 31 }]],
    ['HONDA|CIVIC', [{ year: 2009, make: 'HONDA', model: 'CIVIC', rowNumber: 32 }]],
  ]);
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({
      yardOptions: ['1020'],
      makeOptions: ['TOYOTA', 'HONDA'],
    }),
    'POST /Home/GetMakes': ok([{ makeName: 'TOYOTA' }, { makeName: 'HONDA' }]),
    'POST /Home/GetModels': ({ payload }) => {
      const make = String(payload.makeName || '').toUpperCase();
      if (make === 'TOYOTA') {
        throw new Error('simulated TOYOTA model endpoint failure');
      }
      return ok(make === 'HONDA' ? [{ model: 'CIVIC' }] : []);
    },
    'POST /': ({ payload }) => {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      return inventoryPage({
        yardOptions: ['1020'],
        rows: rowsBySearch.get(`${make}|${model}`) || [],
      });
    },
  });

  await scrapeWithHttp(createScrapeConfig(), {
    cheerio,
    httpClient,
    insertOrUpdateVehicle: async (...args) => upserts.push(args),
    markInactiveVehicles: async (sessionID, options) => markCalls.push({ sessionID, options }),
  });

  assert.deepEqual(
    upserts.map((args) => ({ make: args[1], model: args[2], year: args[3], row: args[4] })),
    [
      { make: 'TOYOTA', model: 'CAMRY', year: 2008, row: 31 },
      { make: 'HONDA', model: 'CIVIC', year: 2009, row: 32 },
    ]
  );
  assert.equal(markCalls.length, 0);
});

test('http scraper skips inactive reconciliation when scrape fails after partial upserts', async () => {
  const upserts = [];
  const markCalls = [];
  const submissions = new Map([
    [
      'TOYOTA|CAMRY',
      () =>
        inventoryPage({
          yardOptions: ['1020'],
          rows: [{ year: 2011, make: 'TOYOTA', model: 'CAMRY', rowNumber: 42 }],
        }),
    ],
    [
      'TOYOTA|COROLLA',
      () => {
        throw new Error('simulated COROLLA scrape failure');
      },
    ],
  ]);
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({ yardOptions: ['1020'], makeOptions: ['TOYOTA'] }),
    'POST /Home/GetModels': ok([{ model: 'CAMRY' }, { model: 'COROLLA' }]),
    'POST /': ({ payload }) => {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const respond = submissions.get(`${make}|${model}`);
      return respond ? respond() : inventoryPage({ yardOptions: ['1020'], rows: [] });
    },
  });

  await assert.rejects(
    scrapeWithHttp(createScrapeConfig({ make: 'TOYOTA' }), {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => upserts.push(args),
      markInactiveVehicles: async (sessionID, options) => markCalls.push({ sessionID, options }),
    }),
    /simulated COROLLA scrape failure/
  );

  assert.equal(upserts.length, 1);
  assert.equal(markCalls.length, 0);
});
