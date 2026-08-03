const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activateSmokeEnvironment,
  cleanupSmokeDatabase,
  closeDatabase,
  getSQL,
  prepareSmokeDatabase,
  resolveSmokeDatabasePath,
  restoreSmokeEnvironment,
  runSQL,
} = require('../src/testing/liveScrapeSmokeRuntime');

test('smoke database paths support explicit and deterministic temporary paths', () => {
  const pathModule = {
    resolve(value) {
      return `/resolved/${value}`;
    },
    join(...parts) {
      return parts.join('/');
    },
  };
  const osModule = { tmpdir: () => '/isolated-temp' };

  assert.equal(
    resolveSmokeDatabasePath(
      { dbPath: 'custom.db' },
      { now: () => 123, osModule, pathModule }
    ),
    '/resolved/custom.db'
  );
  assert.equal(
    resolveSmokeDatabasePath(
      { dbPath: null },
      { now: () => 123, osModule, pathModule }
    ),
    '/isolated-temp/jalopy-live-smoke-123.db'
  );
});

test('smoke environment activation and restoration preserve prior values', () => {
  const env = {
    VEHICLE_DB_PATH: '/original/inventory.db',
    SCRAPER_ENGINE: 'selenium',
    CHROMEDRIVER_PATH: '/original/chromedriver',
  };
  const snapshot = activateSmokeEnvironment(
    { engine: 'http' },
    '/isolated/smoke.db',
    env
  );

  assert.deepEqual(env, {
    VEHICLE_DB_PATH: '/isolated/smoke.db',
    SCRAPER_ENGINE: 'http',
    CHROMEDRIVER_PATH: '/original/chromedriver',
  });

  env.CHROMEDRIVER_PATH = '/mutated/chromedriver';
  restoreSmokeEnvironment(snapshot, env);
  assert.deepEqual(env, {
    VEHICLE_DB_PATH: '/original/inventory.db',
    SCRAPER_ENGINE: 'selenium',
    CHROMEDRIVER_PATH: '/original/chromedriver',
  });
});

test('smoke environment restoration removes values that were initially absent', () => {
  const env = {};
  const snapshot = activateSmokeEnvironment(
    { engine: null },
    '/isolated/smoke.db',
    env
  );

  env.SCRAPER_ENGINE = 'mutated';
  env.CHROMEDRIVER_PATH = 'mutated';
  restoreSmokeEnvironment(snapshot, env);
  assert.deepEqual(env, {});
});

test('SQLite smoke helpers preserve results and rejection identities', async () => {
  const runResult = { changes: 2 };
  const expectedRow = { count: 7 };
  const runError = new Error('run failed');
  const getError = new Error('get failed');
  const closeError = new Error('close failed');

  assert.equal(
    await runSQL(
      {
        run(sql, params, callback) {
          assert.equal(sql, 'UPDATE vehicles');
          assert.deepEqual(params, [1020]);
          callback.call(runResult, null);
        },
      },
      'UPDATE vehicles',
      [1020]
    ),
    runResult
  );
  assert.equal(
    await getSQL(
      {
        get(sql, params, callback) {
          assert.equal(sql, 'SELECT vehicles');
          assert.deepEqual(params, []);
          callback(null, expectedRow);
        },
      },
      'SELECT vehicles'
    ),
    expectedRow
  );
  await closeDatabase({ close: (callback) => callback(null) });

  await assert.rejects(
    runSQL({ run: (sql, params, callback) => callback(runError) }, 'SQL'),
    (error) => error === runError
  );
  await assert.rejects(
    getSQL({ get: (sql, params, callback) => callback(getError) }, 'SQL'),
    (error) => error === getError
  );
  await assert.rejects(
    closeDatabase({ close: (callback) => callback(closeError) }),
    (error) => error === closeError
  );
});

test('smoke database preparation creates its parent before setup', async () => {
  const events = [];
  await prepareSmokeDatabase(
    '/isolated/smoke/inventory.db',
    async () => events.push('setup'),
    {
      mkdirSync(directory, options) {
        events.push(['mkdir', directory, options]);
      },
    }
  );

  assert.deepEqual(events, [
    ['mkdir', '/isolated/smoke', { recursive: true }],
    'setup',
  ]);
});

test('smoke database cleanup deletes disposable files and preserves kept files', () => {
  const removed = [];
  const logs = [];
  const fsModule = {
    existsSync: () => true,
    rmSync(filePath, options) {
      removed.push([filePath, options]);
    },
  };
  const logger = { log: (message) => logs.push(message) };

  cleanupSmokeDatabase(
    { dbFilePath: '/isolated/disposable.db', keepDb: false },
    logger,
    fsModule
  );
  cleanupSmokeDatabase(
    { dbFilePath: '/isolated/kept\nforged.db', keepDb: true },
    logger,
    fsModule
  );

  assert.deepEqual(removed, [
    ['/isolated/disposable.db', { force: true }],
  ]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes('\n'), false);
  assert.match(logs[0], /Kept isolated DB at: \/isolated\/kept forged\.db/);
});

test('smoke database cleanup is a no-op when its file is already absent', () => {
  let removeCalled = false;
  cleanupSmokeDatabase(
    { dbFilePath: '/isolated/absent.db', keepDb: false },
    { log() {} },
    {
      existsSync: () => false,
      rmSync() {
        removeCalled = true;
      },
    }
  );

  assert.equal(removeCalled, false);
});
