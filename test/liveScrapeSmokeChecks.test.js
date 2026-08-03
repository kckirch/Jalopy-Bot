const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeSmokeChecks,
} = require('../src/testing/liveScrapeSmokeChecks');

function createSingleYardDatabase({
  yardCount = 1,
  sentinelRow = { vehicle_status: 'ACTIVE', session_id: '19990101' },
  inactiveCount = 0,
} = {}) {
  return {
    run(sql, params, callback) {
      assert.match(sql, /INSERT INTO vehicles/);
      assert.equal(params[0] === 1020, false);
      callback(null);
    },
    get(sql, params, callback) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
      if (normalized.includes('WHERE YARD_ID = ? AND VEHICLE_MAKE = ?')) {
        callback(null, sentinelRow);
        return;
      }
      if (normalized.includes("SESSION_ID = ? AND VEHICLE_STATUS = 'INACTIVE'")) {
        callback(null, { count: inactiveCount });
        return;
      }
      if (normalized.includes('COUNT(*) AS COUNT FROM VEHICLES WHERE YARD_ID = ?')) {
        callback(null, yardCount === null ? null : { count: yardCount });
        return;
      }
      callback(new Error(`Unhandled smoke-check SQL: ${sql}`));
    },
  };
}

function createSingleYardContext(overrides = {}) {
  return {
    args: {
      location: 'boise',
      locations: null,
      make: 'TOYOTA',
      model: 'CAMRY',
    },
    dbFilePath: '/tmp/jalopy-smoke-checks-unit.db',
    logger: { log() {} },
    db: createSingleYardDatabase(),
    async setupDatabase() {},
    junkyards: {
      jalopyJungle: {
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: true,
      },
    },
    convertLocationToYardId: () => 1020,
    getSessionID: () => '20260101',
    async universalWebScrape() {},
    ...overrides,
  };
}

test('smoke checks reject a missing yard configuration', async () => {
  await assert.rejects(
    executeSmokeChecks(createSingleYardContext({ junkyards: {} })),
    /Missing junkyard config/
  );
});

test('single-yard smoke checks reject absent and empty full-scrape results', async (t) => {
  for (const yardCount of [null, 0]) {
    await t.test(`count ${String(yardCount)}`, async () => {
      await assert.rejects(
        executeSmokeChecks(
          createSingleYardContext({
            db: createSingleYardDatabase({ yardCount }),
          })
        ),
        /full scrape returned 0 rows for yard 1020/
      );
    });
  }
});

test('single-yard smoke checks characterize every sentinel safety failure', async (t) => {
  const cases = [
    {
      name: 'missing sentinel',
      sentinelRow: null,
      inactiveCount: 0,
      expected: /sentinel row missing/,
    },
    {
      name: 'changed status',
      sentinelRow: { vehicle_status: 'INACTIVE', session_id: '19990101' },
      inactiveCount: 0,
      expected: /sentinel row status changed to INACTIVE/,
    },
    {
      name: 'changed session',
      sentinelRow: { vehicle_status: 'ACTIVE', session_id: 'changed' },
      inactiveCount: 0,
      expected: /sentinel session changed to changed/,
    },
    {
      name: 'inactive current-session rows',
      sentinelRow: { vehicle_status: 'ACTIVE', session_id: '19990101' },
      inactiveCount: 2,
      expected: /found 2 INACTIVE rows for current partial session/,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      await assert.rejects(
        executeSmokeChecks(
          createSingleYardContext({
            db: createSingleYardDatabase(testCase),
          })
        ),
        testCase.expected
      );
    });
  }
});

test('single-yard smoke checks retain default partial make and model fallbacks', async () => {
  const scrapeCalls = [];
  const context = createSingleYardContext({
    args: {
      location: 'boise',
      locations: [],
      make: '',
      model: '',
    },
    async universalWebScrape(options) {
      scrapeCalls.push(options);
    },
  });

  const result = await executeSmokeChecks(context);

  assert.equal(result.ok, true);
  assert.equal(scrapeCalls.length, 2);
  assert.equal(scrapeCalls[1].make, 'TOYOTA');
  assert.equal(scrapeCalls[1].model, 'CAMRY');
  assert.equal(scrapeCalls[1].shouldMarkInactive, false);
});
