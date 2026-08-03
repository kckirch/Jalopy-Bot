const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cheerio = require('cheerio');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'test/fixtures/http-replay');
const scrapeModulePath = path.join(repoRoot, 'src/scraping/httpInventoryScrape.js');
const { scrapeWithHttp } = require(scrapeModulePath);
const {
  extractResultRows,
} = require('../src/scraping/httpInventoryParser');

function readFixtureText(name) {
  return fs.readFileSync(path.join(fixtureRoot, name), 'utf8');
}

function readFixtureJson(name) {
  return JSON.parse(readFixtureText(name));
}

function parsePayload(config) {
  if (typeof config.data === 'string') {
    return Object.fromEntries(new URLSearchParams(config.data).entries());
  }
  if (config.params && typeof config.params === 'object') {
    return config.params;
  }
  return {};
}

function resolveFixtureRoute(config) {
  const method = String(config.method || 'GET').toUpperCase();
  const pathname = new URL(config.url).pathname;
  const payload = parsePayload(config);
  const requestRoute = `${method} ${pathname}`;

  if (requestRoute === 'GET /') {
    return { key: 'inventory:initial' };
  }
  if (requestRoute === 'POST /Home/GetMakes') {
    return {
      key: `makes:${String(payload.yardId || '')}`,
      fallbackKey: 'makes:default',
    };
  }
  if (requestRoute === 'POST /Home/GetModels') {
    const yardId = String(payload.yardId || '');
    const makeName = String(payload.makeName || '').toUpperCase();
    return {
      key: `models:${yardId}:${makeName}`,
      fallbackKey: 'models:default',
    };
  }
  if (requestRoute === 'POST /') {
    const yardId = String(payload.YardId || '1020');
    const make = String(payload.VehicleMake || '').toUpperCase();
    const model = String(payload.VehicleModel || '').toUpperCase();
    return {
      key: make ? `inventory:${yardId}:${make}:${model}` : 'inventory:initial',
      fallbackKey: 'inventory:initial',
    };
  }

  throw new Error(`Unexpected request in fixture replay: ${requestRoute}`);
}

function createFixtureReplayHttpClient() {
  const fixturesByRoute = new Map([
    ['inventory:initial', readFixtureText('boise_initial.html')],
    [
      'inventory:1020:TOYOTA:CAMRY',
      readFixtureText('boise_toyota_camry.html'),
    ],
    [
      'inventory:1020:TOYOTA:COROLLA',
      readFixtureText('boise_toyota_corolla.html'),
    ],
    [
      'inventory:1020:HONDA:CIVIC',
      readFixtureText('boise_honda_civic.html'),
    ],
    [
      'inventory:1021:TOYOTA:CAMRY',
      readFixtureText('caldwell_toyota_camry.html'),
    ],
    ['makes:1020', readFixtureJson('get_makes_1020.json')],
    ['makes:1021', readFixtureJson('get_makes_1021.json')],
    ['makes:default', []],
    ['models:1020:TOYOTA', readFixtureJson('get_models_1020_toyota.json')],
    ['models:1020:HONDA', readFixtureJson('get_models_1020_honda.json')],
    ['models:1021:TOYOTA', readFixtureJson('get_models_1021_toyota.json')],
    ['models:default', []],
  ]);

  return {
    async request(config) {
      const { key, fallbackKey } = resolveFixtureRoute(config);
      const fixtureKey = fixturesByRoute.has(key) ? key : fallbackKey;
      return { status: 200, headers: {}, data: fixturesByRoute.get(fixtureKey) };
    },
  };
}

test('fixture replay client preserves family fallbacks and rejects unknown routes', async () => {
  const httpClient = createFixtureReplayHttpClient();
  const makesResponse = await httpClient.request({
    method: 'POST',
    url: 'https://inventory.example/Home/GetMakes',
    params: { yardId: '9999' },
  });
  const modelsResponse = await httpClient.request({
    method: 'POST',
    url: 'https://inventory.example/Home/GetModels',
    data: new URLSearchParams({ yardId: '9999', makeName: 'UNKNOWN' }).toString(),
  });
  const inventoryResponse = await httpClient.request({
    method: 'POST',
    url: 'https://inventory.example/',
    data: new URLSearchParams({
      YardId: '9999',
      VehicleMake: 'UNKNOWN',
      VehicleModel: 'UNKNOWN',
    }).toString(),
  });

  assert.deepEqual(makesResponse.data, []);
  assert.deepEqual(modelsResponse.data, []);
  assert.equal(inventoryResponse.data, readFixtureText('boise_initial.html'));
  await assert.rejects(
    httpClient.request({
      method: 'DELETE',
      url: 'https://inventory.example/unexpected',
    }),
    /Unexpected request in fixture replay: DELETE \/unexpected/
  );
});

test('fixture replay parser preserves duplicate CAMRY rows from real HTML', () => {
  const html = readFixtureText('boise_toyota_camry.html');
  const $ = cheerio.load(html);
  const rows = extractResultRows($);

  assert.equal(rows.length, 19);
  const duplicateRows = rows.filter(
    (row) =>
      row.year === 2003 &&
      row.make === 'TOYOTA' &&
      row.model === 'CAMRY' &&
      row.rowNumber === 50
  );
  assert.equal(duplicateRows.length, 2);
});

test('fixture replay ANY/ANY scrape follows dynamic endpoints and upserts expected rows', async () => {
  const upserts = [];
  const markCalls = [];

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: '1020',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient: createFixtureReplayHttpClient(),
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(upserts.length, 22);
  const duplicateRows = upserts.filter(
    (args) =>
      Number(args[0]) === 1020 &&
      args[1] === 'TOYOTA' &&
      args[2] === 'CAMRY' &&
      Number(args[3]) === 2003 &&
      Number(args[4]) === 50
  );
  assert.equal(duplicateRows.length, 2);
  assert.ok(upserts.some((args) => args[1] === 'HONDA' && args[2] === 'CIVIC'));
  assert.ok(upserts.some((args) => args[1] === 'TOYOTA' && args[2] === 'COROLLA'));
  assert.equal(markCalls.length, 1);
  assert.equal(markCalls[0].sessionID, '20260224');
  assert.deepEqual(markCalls[0].options, { yardIds: [1020] });
});

test('fixture replay multi-yard scrape uses dropdown yard options and scopes reconcile per yard set', async () => {
  const upserts = [];
  const markCalls = [];

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: null,
      make: 'TOYOTA',
      model: 'CAMRY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient: createFixtureReplayHttpClient(),
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(upserts.length, 20);
  const byYard = upserts.reduce((acc, args) => {
    const yardId = Number(args[0]);
    acc[yardId] = (acc[yardId] || 0) + 1;
    return acc;
  }, {});

  assert.equal(byYard[1020], 19);
  assert.equal(byYard[1021], 1);
  assert.ok(
    upserts.some(
      (args) =>
        Number(args[0]) === 1021 &&
        args[1] === 'TOYOTA' &&
        args[2] === 'CAMRY' &&
        Number(args[3]) === 2011 &&
        Number(args[4]) === 88
    )
  );
  assert.equal(markCalls.length, 1);
  assert.equal(markCalls[0].sessionID, '20260224');
  assert.deepEqual(markCalls[0].options, { yardIds: [1020, 1021] });
});
