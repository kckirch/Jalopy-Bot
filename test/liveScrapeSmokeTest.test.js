const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'src/testing/liveScrapeSmokeTest.js');

const {
  parseArgs,
  resolveScrapeTarget,
  resolveScrapeTargets,
  __testables,
  runLiveScrapeSmokeCli,
  runLiveScrapeSmokeTest,
} = require(modulePath);

test('parseArgs parses supported smoke-script flags', () => {
  const parsed = parseArgs([
    '--location', 'trustypickapart',
    '--locations', 'boise,caldwell',
    '--make', 'ford',
    '--model', 'focus',
    '--engine', 'http',
    '--db-path', '/tmp/smoke.db',
    '--keep-db',
  ]);

  assert.equal(parsed.location, 'trustypickapart');
  assert.deepEqual(parsed.locations, ['boise', 'caldwell']);
  assert.equal(parsed.make, 'ford');
  assert.equal(parsed.model, 'focus');
  assert.equal(parsed.engine, 'http');
  assert.equal(parsed.dbPath, '/tmp/smoke.db');
  assert.equal(parsed.keepDb, true);
});

test('live smoke CLI redacts failures and sets a failing exit code', async () => {
  const privateErrorDetails = 'private smoke path /home/kc/private-inventory.db';
  const previousExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    const consoleCalls = await captureConsole(async () => {
      await runLiveScrapeSmokeCli(async () => {
        throw new TypeError(privateErrorDetails);
      });
    });

    assert.equal(process.exitCode, 1);
    assert.match(joinedConsoleText(consoleCalls), /\[smoke\] FAIL: TypeError/);
    assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('resolveScrapeTarget maps trustypickapart explicitly and rejects grouped locations', () => {
  const convertLocationToYardId = (location) => {
    if (location === 'all') return 'ALL';
    if (location === 'treasurevalleyyards') return [1020, 1021];
    if (location === 'boise') return 1020;
    return 'ALL';
  };

  const trusty = resolveScrapeTarget('trustypickapart', convertLocationToYardId);
  assert.deepEqual(trusty, { junkyardKey: 'trustyJunkyard', yardId: 999999 });

  const boise = resolveScrapeTarget('boise', convertLocationToYardId);
  assert.deepEqual(boise, { junkyardKey: 'jalopyJungle', yardId: 1020 });

  assert.throws(
    () => resolveScrapeTarget('all', convertLocationToYardId),
    /single concrete location/i
  );
  assert.throws(
    () => resolveScrapeTarget('treasurevalleyyards', convertLocationToYardId),
    /single concrete location/i
  );

  const targets = resolveScrapeTargets(['boise', 'trustypickapart'], convertLocationToYardId);
  assert.deepEqual(targets, [
    { junkyardKey: 'jalopyJungle', yardId: 1020 },
    { junkyardKey: 'trustyJunkyard', yardId: 999999 },
  ]);
});

test('live smoke runner uses isolated DB path and executes full + partial scrape checks', async () => {
  const state = {
    rows: [],
    setupCalled: 0,
    scrapeCalls: [],
    dbClosed: 0,
  };

  const fakeDb = {
    run(sql, params, callback) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();

      if (normalized.startsWith('INSERT INTO VEHICLES')) {
        state.rows.push({
          yard_id: Number(params[0]),
          vehicle_make: String(params[2]),
          vehicle_model: String(params[3]),
          vehicle_status: String(params[6]),
          session_id: String(params[8]),
        });
        callback(null);
        return;
      }

      callback(new Error(`Unhandled run SQL in test stub: ${sql}`));
    },
    get(sql, params, callback) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();

      if (normalized.includes('SELECT COUNT(*) AS COUNT FROM VEHICLES WHERE YARD_ID = ?')) {
        const count = state.rows.filter((row) => row.yard_id === Number(params[0])).length;
        callback(null, { count });
        return;
      }

      if (normalized.includes('WHERE YARD_ID = ? AND VEHICLE_MAKE = ? AND VEHICLE_MODEL = ?')) {
        const row = state.rows.find(
          (item) =>
            item.yard_id === Number(params[0]) &&
            item.vehicle_make === String(params[1]) &&
            item.vehicle_model === String(params[2])
        );
        callback(null, row ? { vehicle_status: row.vehicle_status, session_id: row.session_id } : undefined);
        return;
      }

      if (normalized.includes("WHERE SESSION_ID = ? AND VEHICLE_STATUS = 'INACTIVE'")) {
        const count = state.rows.filter(
          (row) => row.session_id === String(params[0]) && row.vehicle_status === 'INACTIVE'
        ).length;
        callback(null, { count });
        return;
      }

      callback(new Error(`Unhandled get SQL in test stub: ${sql}`));
    },
    close(callback) {
      state.dbClosed += 1;
      callback(null);
    },
  };

  const logger = { log() {}, error() {} };
  const result = await runLiveScrapeSmokeTest({
    argv: ['--location', 'boise', '--db-path', '/tmp/jalopy-smoke-unit.db', '--keep-db'],
    logger,
    deps: {
      junkyards: {
        jalopyJungle: { inventoryUrl: 'https://example', hasMultipleLocations: true },
        trustyJunkyard: { inventoryUrl: 'https://trusty', hasMultipleLocations: false, yardId: '999999' },
      },
      convertLocationToYardId: () => 1020,
      getSessionID: () => '20260101',
      databaseModule: {
        async setupDatabase() {
          state.setupCalled += 1;
        },
        db: fakeDb,
      },
      async universalWebScrape(options) {
        state.scrapeCalls.push(options);
        if (options.make === 'ANY' && options.model === 'ANY') {
          state.rows.push({
            yard_id: Number(options.yardId),
            vehicle_make: 'LIVE',
            vehicle_model: 'ROW',
            vehicle_status: 'NEW',
            session_id: options.sessionID,
          });
        }
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(state.setupCalled, 1);
  assert.equal(state.scrapeCalls.length, 2);
  assert.equal(state.scrapeCalls[0].shouldMarkInactive, true);
  assert.equal(state.scrapeCalls[1].shouldMarkInactive, false);
  assert.equal(state.dbClosed, 1);
});

test('live smoke runner supports multi-yard mode with --locations', async () => {
  const state = {
    rows: [],
    scrapeCalls: [],
    dbClosed: 0,
  };

  const fakeDb = {
    run(sql, params, callback) {
      callback(null);
    },
    get(sql, params, callback) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
      if (normalized.includes('SELECT COUNT(*) AS COUNT FROM VEHICLES WHERE YARD_ID = ?')) {
        const count = state.rows.filter((row) => row.yard_id === Number(params[0])).length;
        callback(null, { count });
        return;
      }
      callback(new Error(`Unhandled get SQL in multi-yard test stub: ${sql}`));
    },
    close(callback) {
      state.dbClosed += 1;
      callback(null);
    },
  };

  const logger = { log() {}, error() {} };
  const result = await runLiveScrapeSmokeTest({
    argv: ['--locations', 'boise,caldwell', '--db-path', '/tmp/jalopy-smoke-multi-unit.db', '--keep-db'],
    logger,
    deps: {
      junkyards: {
        jalopyJungle: { inventoryUrl: 'https://example', hasMultipleLocations: true },
      },
      convertLocationToYardId: (location) => {
        if (location === 'boise') return 1020;
        if (location === 'caldwell') return 1021;
        return 'ALL';
      },
      getSessionID: () => '20260101',
      databaseModule: {
        async setupDatabase() {},
        db: fakeDb,
      },
      async universalWebScrape(options) {
        state.scrapeCalls.push(options);
        state.rows.push({ yard_id: Number(options.yardId) });
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'multi-yard');
  assert.equal(state.scrapeCalls.length, 2);
  assert.equal(state.scrapeCalls[0].yardId, 1020);
  assert.equal(state.scrapeCalls[1].yardId, 1021);
  assert.equal(state.dbClosed, 1);
});

test('multi-yard smoke runner fails when any yard returns zero rows', async () => {
  const state = {
    rows: [],
    scrapeCalls: [],
    dbClosed: 0,
  };

  const fakeDb = {
    run(sql, params, callback) {
      callback(null);
    },
    get(sql, params, callback) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
      if (normalized.includes('SELECT COUNT(*) AS COUNT FROM VEHICLES WHERE YARD_ID = ?')) {
        const count = state.rows.filter((row) => row.yard_id === Number(params[0])).length;
        callback(null, { count });
        return;
      }
      callback(new Error(`Unhandled get SQL in multi-yard fail test stub: ${sql}`));
    },
    close(callback) {
      state.dbClosed += 1;
      callback(null);
    },
  };

  const logger = { log() {}, error() {} };

  await assert.rejects(
    runLiveScrapeSmokeTest({
      argv: ['--locations', 'boise,caldwell', '--db-path', '/tmp/jalopy-smoke-multi-fail-unit.db', '--keep-db'],
      logger,
      deps: {
        junkyards: {
          jalopyJungle: { inventoryUrl: 'https://example', hasMultipleLocations: true },
        },
        convertLocationToYardId: (location) => {
          if (location === 'boise') return 1020;
          if (location === 'caldwell') return 1021;
          return 'ALL';
        },
        getSessionID: () => '20260101',
        databaseModule: {
          async setupDatabase() {},
          db: fakeDb,
        },
        async universalWebScrape(options) {
          state.scrapeCalls.push(options);
          if (Number(options.yardId) === 1020) {
            state.rows.push({ yard_id: 1020 });
          }
        },
      },
    }),
    /full scrape returned 0 rows for yard 1021/i
  );

  assert.equal(state.scrapeCalls.length, 2);
  assert.equal(state.dbClosed, 1);
});

test('live smoke runner restores env vars after an error', async () => {
  const previousVehicleDbPath = process.env.VEHICLE_DB_PATH;
  const previousScraperEngine = process.env.SCRAPER_ENGINE;
  const previousChromedriverPath = process.env.CHROMEDRIVER_PATH;
  const fakeDb = {
    run(sql, params, callback) {
      callback(null);
    },
    get(sql, params, callback) {
      callback(null, { count: 0 });
    },
    close(callback) {
      callback(null);
    },
  };

  process.env.VEHICLE_DB_PATH = '/tmp/original-vehicle-db-path.db';
  process.env.SCRAPER_ENGINE = 'selenium';
  process.env.CHROMEDRIVER_PATH = '/tmp/original-chromedriver';

  try {
    await assert.rejects(
      runLiveScrapeSmokeTest({
        argv: ['--location', 'all', '--engine', 'http', '--db-path', '/tmp/jalopy-smoke-env-restore-unit.db'],
        logger: { log() {}, error() {} },
        deps: {
          junkyards: {
            jalopyJungle: { inventoryUrl: 'https://example', hasMultipleLocations: true },
          },
          convertLocationToYardId: () => 'ALL',
          getSessionID: () => '20260101',
          databaseModule: {
            async setupDatabase() {},
            db: fakeDb,
          },
          async universalWebScrape() {},
        },
      }),
      /single concrete location/i
    );

    assert.equal(process.env.VEHICLE_DB_PATH, '/tmp/original-vehicle-db-path.db');
    assert.equal(process.env.SCRAPER_ENGINE, 'selenium');
    assert.equal(process.env.CHROMEDRIVER_PATH, '/tmp/original-chromedriver');
  } finally {
    if (typeof previousVehicleDbPath === 'string') {
      process.env.VEHICLE_DB_PATH = previousVehicleDbPath;
    } else {
      delete process.env.VEHICLE_DB_PATH;
    }
    if (typeof previousScraperEngine === 'string') {
      process.env.SCRAPER_ENGINE = previousScraperEngine;
    } else {
      delete process.env.SCRAPER_ENGINE;
    }
    if (typeof previousChromedriverPath === 'string') {
      process.env.CHROMEDRIVER_PATH = previousChromedriverPath;
    } else {
      delete process.env.CHROMEDRIVER_PATH;
    }
  }
});

test('live smoke runner reports a database close failure after successful checks', async () => {
  const closeError = new Error('forced-close-failure');
  const loggedErrors = [];
  const fakeDb = {
    get(sql, params, callback) {
      callback(null, { count: 1 });
    },
    close(callback) {
      callback(closeError);
    },
  };

  await assert.rejects(
    runLiveScrapeSmokeTest({
      argv: ['--locations', 'boise', '--db-path', '/tmp/jalopy-smoke-close-fail-unit.db', '--keep-db'],
      logger: {
        log() {},
        error(...args) {
          loggedErrors.push(args);
        },
      },
      deps: {
        junkyards: {
          jalopyJungle: { inventoryUrl: 'https://example', hasMultipleLocations: true },
        },
        convertLocationToYardId: () => 1020,
        getSessionID: () => '20260101',
        databaseModule: {
          async setupDatabase() {},
          db: fakeDb,
        },
        async universalWebScrape() {},
      },
    }),
    (error) => error === closeError
  );

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][1], 'Error');
});

test('live smoke runner preserves its primary error when database close also fails', async () => {
  const smokeError = new Error('forced-smoke-failure');
  const closeError = new Error('forced-close-failure');
  const loggedErrors = [];
  const fakeDb = {
    close(callback) {
      callback(closeError);
    },
  };

  await assert.rejects(
    runLiveScrapeSmokeTest({
      argv: ['--location', 'boise', '--db-path', '/tmp/jalopy-smoke-double-fail-unit.db', '--keep-db'],
      logger: {
        log() {},
        error(...args) {
          loggedErrors.push(args);
        },
      },
      deps: {
        junkyards: {
          jalopyJungle: { inventoryUrl: 'https://example', hasMultipleLocations: true },
        },
        convertLocationToYardId: () => 1020,
        getSessionID: () => '20260101',
        databaseModule: {
          async setupDatabase() {
            throw smokeError;
          },
          db: fakeDb,
        },
        async universalWebScrape() {},
      },
    }),
    (error) => error === smokeError
  );

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0][1], 'Error');
});

test('smoke test helpers provide deterministic behavior', () => {
  assert.equal(__testables.normalizeSessionId('20260101'), '20260102');
  assert.equal(__testables.normalizeSessionId('abc'), 'abc1');
  assert.notEqual(__testables.selectSentinelYard(1020), 1020);
  assert.match(__testables.getUsageText(), /Usage:/);
});
