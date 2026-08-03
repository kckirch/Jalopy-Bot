const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

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

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
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

  const databaseModule = require(databasePath);
  ({ db } = databaseModule);
  savedSearchManager = require(savedSearchManagerPath);
  await databaseModule.setupDatabase();
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

test('saved-search operations do not log private record fields', async () => {
  const privateValues = [
    'private-user-id',
    'private-user#0001',
    'PRIVATE-MODEL',
    'private note',
  ];
  const consoleCalls = await captureConsole(async () => {
    await savedSearchManager.addSavedSearch(
      privateValues[0],
      privateValues[1],
      '1020',
      'BOISE',
      'PRIVATE-MAKE',
      privateValues[2],
      '2001-2005',
      'ACTIVE',
      privateValues[3]
    );
    await savedSearchManager.checkExistingSearch(
      privateValues[0],
      '1020',
      'PRIVATE-MAKE',
      privateValues[2],
      '2001-2005',
      'ACTIVE'
    );
    await savedSearchManager.getSavedSearches(privateValues[0]);
  });

  const logOutput = joinedConsoleText(consoleCalls);
  for (const privateValue of privateValues) {
    assert.equal(logOutput.includes(privateValue), false, privateValue);
  }
});

test('addSavedSearch rejects on database insert failure', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-file';
  const originalRun = db.run.bind(db);
  db.run = function runWithFailure(sql, params, callback) {
    if (typeof callback === 'function') {
      callback(new Error(privateErrorDetails));
      return this;
    }
    return originalRun(sql, params, callback);
  };

  try {
    const consoleCalls = await captureConsole(async () => {
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
        (error) => error.message === privateErrorDetails
      );
    });

    const logOutput = joinedConsoleText(consoleCalls);
    assert.match(logOutput, /Error adding new saved search: Error/);
    assert.equal(logOutput.includes(privateErrorDetails), false);
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

test('setSavedSearchFrequency persists the selected frequency', async () => {
  const insertedId = await savedSearchManager.addSavedSearch(
    'user-frequency',
    'frequency#1',
    '1020',
    'BOISE',
    'TOYOTA',
    'CAMRY',
    'ANY',
    'ACTIVE',
    ''
  );

  await savedSearchManager.setSavedSearchFrequency(insertedId, 'paused');

  const rows = await savedSearchManager.getSavedSearches('user-frequency');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].frequency, 'paused');
});

test('checkExistingSearch rejects and redacts database lookup failures', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-lookup';
  const originalGet = db.get.bind(db);
  db.get = function getWithFailure(_sql, _params, callback) {
    callback(new Error(privateErrorDetails));
    return this;
  };

  try {
    const consoleCalls = await captureConsole(async () => {
      await assert.rejects(
        savedSearchManager.checkExistingSearch(
          'user-fail',
          '1020',
          'TOYOTA',
          'CAMRY',
          'ANY',
          'ACTIVE'
        ),
        (error) => error.message === privateErrorDetails
      );
    });

    const logOutput = joinedConsoleText(consoleCalls);
    assert.match(logOutput, /SQL error checking for an existing saved search: Error/);
    assert.equal(logOutput.includes(privateErrorDetails), false);
  } finally {
    db.get = originalGet;
  }
});

test('frequency updates and deletes reject and redact database write failures', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-write';
  const originalRun = db.run.bind(db);
  db.run = function runWithFailure(_sql, _params, callback) {
    callback(new Error(privateErrorDetails));
    return this;
  };

  try {
    const consoleCalls = await captureConsole(async () => {
      await assert.rejects(
        savedSearchManager.setSavedSearchFrequency(123, 'paused'),
        (error) => error.message === privateErrorDetails
      );
      await assert.rejects(
        savedSearchManager.deleteSavedSearch(123),
        (error) => error.message === privateErrorDetails
      );
    });

    const logOutput = joinedConsoleText(consoleCalls);
    assert.match(logOutput, /Error updating saved search frequency: Error/);
    assert.match(logOutput, /Error deleting saved search: Error/);
    assert.equal(logOutput.includes(privateErrorDetails), false);
  } finally {
    db.run = originalRun;
  }
});

test('saved-search reads reject and redact database query failures', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-read';
  const originalAll = db.all.bind(db);
  db.all = function allWithFailure(_sql, _params, callback) {
    callback(new Error(privateErrorDetails));
    return this;
  };

  try {
    const consoleCalls = await captureConsole(async () => {
      await assert.rejects(
        savedSearchManager.getSavedSearches('user-fail'),
        (error) => error.message === privateErrorDetails
      );
      await assert.rejects(
        savedSearchManager.getAllSavedSearches(),
        (error) => error.message === privateErrorDetails
      );
    });

    const logOutput = joinedConsoleText(consoleCalls);
    assert.match(logOutput, /Failed to retrieve saved searches: Error/);
    assert.match(logOutput, /Failed to retrieve all saved searches: Error/);
    assert.equal(logOutput.includes(privateErrorDetails), false);
  } finally {
    db.all = originalAll;
  }
});
