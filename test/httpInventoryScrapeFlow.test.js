const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const { scrapeWithHttp } = require('../src/scraping/httpInventoryScrape');
const {
  createRouteHttpClient,
  createScrapeConfig,
  inventoryPage,
  ok,
} = require('../test-support/httpInventoryScrapeHarness');

test('http scraper follows dynamic makes/models flow for ANY/ANY and reconciles inactive rows when rows were upserted', async () => {
  const upserts = [];
  const markCalls = [];
  const rowsByKey = new Map([
    ['TOYOTA|CAMRY', [{ year: 2005, make: 'TOYOTA', model: 'CAMRY', rowNumber: 11 }]],
    ['TOYOTA|COROLLA', [{ year: 2006, make: 'TOYOTA', model: 'COROLLA', rowNumber: 12 }]],
    ['HONDA|CIVIC', [{ year: 2007, make: 'HONDA', model: 'CIVIC', rowNumber: 13 }]],
  ]);
  const modelsByMake = new Map([
    ['TOYOTA', [{ model: 'CAMRY' }, { model: 'COROLLA' }]],
    ['HONDA', [{ model: 'CIVIC' }]],
  ]);
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({
      yardOptions: ['1020'],
      makeOptions: ['TOYOTA', 'HONDA'],
    }),
    'POST /Home/GetMakes': ({ payload }) => {
      assert.equal(payload.yardId, '1020');
      return ok([{ makeName: 'TOYOTA' }, { makeName: 'HONDA' }]);
    },
    'POST /Home/GetModels': ({ payload }) => ok(modelsByMake.get(payload.makeName) || []),
    'POST /': ({ payload }) => {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      return inventoryPage({ yardOptions: ['1020'], rows: rowsByKey.get(`${make}|${model}`) || [] });
    },
  });

  await scrapeWithHttp(createScrapeConfig(), {
    cheerio,
    httpClient,
    insertOrUpdateVehicle: async (...args) => upserts.push(args),
    markInactiveVehicles: async (sessionID, options) => markCalls.push({ sessionID, options }),
  });

  assert.equal(upserts.length, 3);
  assert.ok(
    upserts.every((args) => args.length === 7 && args[5] === '' && args[6] === '20260224')
  );
  assert.deepEqual(
    upserts.map((args) => ({ make: args[1], model: args[2], year: args[3], row: args[4] })),
    [
      { make: 'TOYOTA', model: 'CAMRY', year: 2005, row: 11 },
      { make: 'TOYOTA', model: 'COROLLA', year: 2006, row: 12 },
      { make: 'HONDA', model: 'CIVIC', year: 2007, row: 13 },
    ]
  );
  assert.deepEqual(markCalls, [
    { sessionID: '20260224', options: { yardIds: [1020] } },
  ]);
});

test('http scraper rejects unsafe reconciliation when zero rows were upserted', async () => {
  const markCalls = [];
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({ yardOptions: ['1020'], makeOptions: ['TOYOTA'] }),
    'POST /Home/GetMakes': ok([{ makeName: 'TOYOTA' }]),
    'POST /Home/GetModels': ok([{ model: 'CAMRY' }]),
    'POST /': inventoryPage({ yardOptions: ['1020'], rows: [] }),
  });

  await assert.rejects(
    scrapeWithHttp(createScrapeConfig(), {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async () => {},
      markInactiveVehicles: async (sessionID, options) => markCalls.push({ sessionID, options }),
    }),
    /complete yard coverage/
  );

  assert.equal(markCalls.length, 0);
});

test('http scraper in multi-yard mode iterates discovered yard options', async () => {
  const upserts = [];
  const markCalls = [];
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({
      yardOptions: ['1020', '1020junk', '1021'],
      makeOptions: ['TOYOTA'],
      modelOptions: ['CAMRY'],
    }),
    'POST /': ({ payload }) => {
      const yardId = String(payload.YardId || '').trim();
      const rowNumber = yardId === '1020' ? 10 : 20;
      return inventoryPage({
        yardOptions: ['1020', '1021'],
        rows: [{ year: 2010, make: 'TOYOTA', model: 'CAMRY', rowNumber }],
      });
    },
  });

  await scrapeWithHttp(
    createScrapeConfig({ yardId: null, make: 'TOYOTA', model: 'CAMRY' }),
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => upserts.push(args),
      markInactiveVehicles: async (sessionID, options) => markCalls.push({ sessionID, options }),
    }
  );

  assert.deepEqual(upserts.map((args) => args[0]), ['1020', '1020junk', '1021']);
  assert.deepEqual(markCalls[0].options, { yardIds: [1020, 1021] });
});

test('http scraper single-location mode uses form make options and trusty model lookup payload', async () => {
  const upserts = [];
  const markCalls = [];
  let getMakesCalled = false;
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({
      yardOptions: ['999999'],
      makeOptions: ['TOYOTA'],
      modelOptions: ['CAMRY'],
    }),
    'POST /Home/GetMakes': () => {
      getMakesCalled = true;
      throw new Error('single-location scrape should not call GetMakes');
    },
    'POST /Home/GetModels': ({ payload }) => {
      assert.equal(payload.makeName, 'TOYOTA');
      assert.equal(payload.showInventory, 'true');
      assert.equal(payload.yardId, undefined);
      return ok([{ model: 'CAMRY' }]);
    },
    'POST /': ({ payload }) => {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const rows =
        make === 'TOYOTA' && model === 'CAMRY'
          ? [{ year: 2012, make: 'TOYOTA', model: 'CAMRY', rowNumber: 44 }]
          : [];
      return inventoryPage({
        yardOptions: ['999999'],
        makeOptions: ['TOYOTA'],
        rows,
      });
    },
  });

  await scrapeWithHttp(
    createScrapeConfig({
      inventoryUrl: 'https://inventory.trustypickapart.com/',
      hasMultipleLocations: false,
      yardId: '999999',
    }),
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => upserts.push(args),
      markInactiveVehicles: async (sessionID, options) => markCalls.push({ sessionID, options }),
    }
  );

  assert.equal(getMakesCalled, false);
  assert.deepEqual(
    upserts.map((args) => ({
      yardId: Number(args[0]),
      make: args[1],
      model: args[2],
      year: args[3],
      row: args[4],
    })),
    [{ yardId: 999999, make: 'TOYOTA', model: 'CAMRY', year: 2012, row: 44 }]
  );
  assert.deepEqual(markCalls[0].options, { yardIds: [999999] });
});

test('http scraper processes duplicate source rows without crashing and still reconciles scoped inactive rows', async () => {
  const upserts = [];
  const markCalls = [];
  const duplicateRows = [
    { year: 2003, make: 'TOYOTA', model: 'CAMRY', rowNumber: 50 },
    { year: 2003, make: 'TOYOTA', model: 'CAMRY', rowNumber: 50 },
  ];
  const httpClient = createRouteHttpClient({
    'GET /': inventoryPage({ yardOptions: ['1020'], makeOptions: ['TOYOTA'] }),
    'POST /Home/GetMakes': ok([{ makeName: 'TOYOTA' }]),
    'POST /Home/GetModels': ok([{ model: 'CAMRY' }]),
    'POST /': ({ payload }) => {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const rows = make === 'TOYOTA' && model === 'CAMRY' ? duplicateRows : [];
      return inventoryPage({ yardOptions: ['1020'], rows });
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
      { make: 'TOYOTA', model: 'CAMRY', year: 2003, row: 50 },
      { make: 'TOYOTA', model: 'CAMRY', year: 2003, row: 50 },
    ]
  );
  assert.deepEqual(markCalls[0].options, { yardIds: [1020] });
});
