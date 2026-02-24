const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cheerio = require('cheerio');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'test/fixtures/http-replay');
const scrapeModulePath = path.join(repoRoot, 'src/scraping/httpInventoryScrape.js');
const { scrapeWithHttp, __testables } = require(scrapeModulePath);

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

function createFixtureReplayHttpClient() {
  const fixtures = {
    boiseInitial: readFixtureText('boise_initial.html'),
    boiseToyotaCamry: readFixtureText('boise_toyota_camry.html'),
    boiseToyotaCorolla: readFixtureText('boise_toyota_corolla.html'),
    boiseHondaCivic: readFixtureText('boise_honda_civic.html'),
    caldwellToyotaCamry: readFixtureText('caldwell_toyota_camry.html'),
    makes1020: readFixtureJson('get_makes_1020.json'),
    makes1021: readFixtureJson('get_makes_1021.json'),
    models1020Toyota: readFixtureJson('get_models_1020_toyota.json'),
    models1020Honda: readFixtureJson('get_models_1020_honda.json'),
    models1021Toyota: readFixtureJson('get_models_1021_toyota.json'),
  };

  return {
    async request(config) {
      const method = String(config.method || 'GET').toUpperCase();
      const pathname = new URL(config.url).pathname;
      const payload = parsePayload(config);

      if (method === 'GET' && pathname === '/') {
        return { status: 200, headers: {}, data: fixtures.boiseInitial };
      }

      if (method === 'POST' && pathname === '/Home/GetMakes') {
        if (String(payload.yardId) === '1020') return { status: 200, headers: {}, data: fixtures.makes1020 };
        if (String(payload.yardId) === '1021') return { status: 200, headers: {}, data: fixtures.makes1021 };
        return { status: 200, headers: {}, data: [] };
      }

      if (method === 'POST' && pathname === '/Home/GetModels') {
        const yardId = String(payload.yardId || '');
        const makeName = String(payload.makeName || '').toUpperCase();
        if (yardId === '1020' && makeName === 'TOYOTA') {
          return { status: 200, headers: {}, data: fixtures.models1020Toyota };
        }
        if (yardId === '1020' && makeName === 'HONDA') {
          return { status: 200, headers: {}, data: fixtures.models1020Honda };
        }
        if (yardId === '1021' && makeName === 'TOYOTA') {
          return { status: 200, headers: {}, data: fixtures.models1021Toyota };
        }
        return { status: 200, headers: {}, data: [] };
      }

      if (method === 'POST' && pathname === '/') {
        const yardId = String(payload.YardId || '1020');
        const make = String(payload.VehicleMake || '').toUpperCase();
        const model = String(payload.VehicleModel || '').toUpperCase();

        if (!make) return { status: 200, headers: {}, data: fixtures.boiseInitial };
        if (yardId === '1020' && make === 'TOYOTA' && model === 'CAMRY') {
          return { status: 200, headers: {}, data: fixtures.boiseToyotaCamry };
        }
        if (yardId === '1020' && make === 'TOYOTA' && model === 'COROLLA') {
          return { status: 200, headers: {}, data: fixtures.boiseToyotaCorolla };
        }
        if (yardId === '1020' && make === 'HONDA' && model === 'CIVIC') {
          return { status: 200, headers: {}, data: fixtures.boiseHondaCivic };
        }
        if (yardId === '1021' && make === 'TOYOTA' && model === 'CAMRY') {
          return { status: 200, headers: {}, data: fixtures.caldwellToyotaCamry };
        }
        return { status: 200, headers: {}, data: fixtures.boiseInitial };
      }

      throw new Error(`Unexpected request in fixture replay: ${method} ${pathname}`);
    },
  };
}

test('fixture replay parser preserves duplicate CAMRY rows from real HTML', () => {
  const html = readFixtureText('boise_toyota_camry.html');
  const $ = cheerio.load(html);
  const rows = __testables.extractResultRows($);

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
