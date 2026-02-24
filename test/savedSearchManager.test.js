const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function waitFor(check, timeoutMs = 2000, intervalMs = 20) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition.');
}

let tempDir;
let originalCwd;
let previousDbPathEnv;
let savedSearchManager;
let db;

test.before(async () => {
  originalCwd = process.cwd();
  previousDbPathEnv = process.env.VEHICLE_DB_PATH;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-saved-search-test-'));
  process.chdir(tempDir);
  process.env.VEHICLE_DB_PATH = path.join(tempDir, 'vehicleInventory.db');

  delete require.cache[dbPathModulePath];
  delete require.cache[savedSearchManagerPath];
  delete require.cache[databasePath];

  savedSearchManager = require(savedSearchManagerPath);
  ({ db } = require(databasePath));

  savedSearchManager.setupSavedSearchesTable();

  await waitFor(async () => {
    const row = await get(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='saved_searches';"
    );
    return Boolean(row);
  });
});

test.beforeEach(async () => {
  await run(db, 'DELETE FROM saved_searches;');
});

test.after(async () => {
  await close(db);
  delete require.cache[dbPathModulePath];
  delete require.cache[savedSearchManagerPath];
  delete require.cache[databasePath];
  if (typeof previousDbPathEnv === 'string') {
    process.env.VEHICLE_DB_PATH = previousDbPathEnv;
  } else {
    delete process.env.VEHICLE_DB_PATH;
  }
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('addSavedSearch + getSavedSearches persists expected data', async () => {
  const insertedId = await savedSearchManager.addSavedSearch(
    'user-1',
    'user#0001',
    '1020',
    'BOISE',
    'TOYOTA',
    'CAMRY',
    '2001-2005',
    'ACTIVE',
    'note'
  );
  assert.ok(typeof insertedId === 'number' && insertedId > 0);

  const rows = await savedSearchManager.getSavedSearches('user-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'user#0001');
  assert.equal(rows[0].yard_name, 'BOISE');
  assert.equal(rows[0].make, 'TOYOTA');
  assert.equal(rows[0].model, 'CAMRY');
});

test('addSavedSearch rejects on database insert failure', async () => {
  const originalRun = db.run.bind(db);
  db.run = function runWithFailure(sql, params, callback) {
    if (typeof callback === 'function') {
      callback(new Error('forced-insert-failure'));
      return this;
    }
    return originalRun(sql, params, callback);
  };

  try {
    await assert.rejects(
      savedSearchManager.addSavedSearch(
        'user-fail',
        'user#fail',
        '1020',
        'BOISE',
        'TOYOTA',
        'CAMRY',
        'ANY',
        'ACTIVE',
        ''
      ),
      /forced-insert-failure/
    );
  } finally {
    db.run = originalRun;
  }
});

test('checkExistingSearch returns true for exact match and false for mismatch', async () => {
  await run(
    db,
    `INSERT INTO saved_searches
      (user_id, username, yard_id, yard_name, make, model, year_range, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    ['user-2', 'user#0002', '1022', 'NAMPA', 'HONDA', 'CIVIC', '2008', 'ACTIVE', '']
  );

  const exists = await savedSearchManager.checkExistingSearch(
    'user-2',
    '1022',
    'HONDA',
    'CIVIC',
    '2008',
    'ACTIVE'
  );
  const notExists = await savedSearchManager.checkExistingSearch(
    'user-2',
    '1022',
    'HONDA',
    'ACCORD',
    '2008',
    'ACTIVE'
  );

  assert.equal(exists, true);
  assert.equal(notExists, false);
});

test('getSavedSearches supports yard filter and deleteSavedSearch removes row', async () => {
  await run(
    db,
    `INSERT INTO saved_searches
      (user_id, username, yard_id, yard_name, make, model, year_range, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      'user-3', 'user#0003', '1020', 'BOISE', 'FORD', 'F-150', 'ANY', 'ACTIVE', '',
      'user-3', 'user#0003', '1021', 'CALDWELL', 'FORD', 'RANGER', 'ANY', 'ACTIVE', '',
    ]
  );

  const boiseOnly = await savedSearchManager.getSavedSearches('user-3', '1020');
  assert.equal(boiseOnly.length, 1);
  assert.equal(boiseOnly[0].yard_name, 'BOISE');

  await savedSearchManager.deleteSavedSearch(boiseOnly[0].id);

  const remaining = await savedSearchManager.getSavedSearches('user-3');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].yard_name, 'CALDWELL');
});

test('getAllSavedSearches returns rows across users', async () => {
  await run(
    db,
    `INSERT INTO saved_searches
      (user_id, username, yard_id, yard_name, make, model, year_range, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      'user-a', 'a#1', '1020', 'BOISE', 'TOYOTA', 'CAMRY', 'ANY', 'ACTIVE', '',
      'user-b', 'b#2', '1021', 'CALDWELL', 'SUBARU', 'OUTBACK', 'ANY', 'ACTIVE', '',
    ]
  );

  const rows = await savedSearchManager.getAllSavedSearches();
  assert.equal(rows.length, 2);
});
