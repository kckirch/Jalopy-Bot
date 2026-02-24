const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const queryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');

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
let queryVehicles;
let queryDb;

test.before(async () => {
  originalCwd = process.cwd();
  previousDbPathEnv = process.env.VEHICLE_DB_PATH;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-query-test-'));
  process.chdir(tempDir);
  process.env.VEHICLE_DB_PATH = path.join(tempDir, 'vehicleInventory.db');

  const seedDb = new sqlite3.Database(path.join(tempDir, 'vehicleInventory.db'));

  await run(
    seedDb,
    `CREATE TABLE vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      yard_id INTEGER,
      yard_name TEXT,
      vehicle_make TEXT,
      vehicle_model TEXT,
      vehicle_year INTEGER,
      row_number INTEGER,
      first_seen TEXT,
      last_seen TEXT,
      vehicle_status TEXT,
      date_added TEXT,
      last_updated TEXT,
      notes TEXT,
      session_id TEXT
    );`
  );

  const rows = [
    [1020, 'BOISE', 'TOYOTA', 'CAMRY', 2005, 11, 'NEW'],
    [1020, 'BOISE', 'JEEP', 'CHEROKEE', 2004, 12, 'ACTIVE'],
    [1020, 'BOISE', 'JEEP', 'GRAND CHEROKEE', 2004, 13, 'ACTIVE'],
    [1021, 'CALDWELL', 'FORD', 'F-150', 2010, 14, 'INACTIVE'],
    [999999, 'TRUSTYPICKAPART', 'BMW', '330CI', 2006, 15, 'ACTIVE'],
  ];

  for (const row of rows) {
    await run(
      seedDb,
      `INSERT INTO vehicles (
        yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
        first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, datetime('now'), datetime('now'), '', '20260101');`,
      row
    );
  }

  await close(seedDb);

  delete require.cache[dbPathModulePath];
  delete require.cache[queryManagerPath];
  ({ queryVehicles, db: queryDb } = require(queryManagerPath));
});

test.after(async () => {
  if (queryDb) {
    await close(queryDb);
  }
  delete require.cache[dbPathModulePath];
  delete require.cache[queryManagerPath];
  if (typeof previousDbPathEnv === 'string') {
    process.env.VEHICLE_DB_PATH = previousDbPathEnv;
  } else {
    delete process.env.VEHICLE_DB_PATH;
  }
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('ACTIVE status query excludes inactive vehicles and respects yard filter', async () => {
  const rows = await queryVehicles(1020, 'ANY', 'ANY', 'ANY', 'ACTIVE');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.yard_id === 1020));
  assert.ok(rows.every((row) => row.vehicle_status !== 'INACTIVE'));
});

test('INACTIVE status query returns only inactive vehicles', async () => {
  const rows = await queryVehicles('ALL', 'ANY', 'ANY', 'ANY', 'INACTIVE');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].yard_name, 'CALDWELL');
  assert.equal(rows[0].vehicle_model, 'F-150');
});

test('JEEP CHEROKEE query excludes GRAND CHEROKEE', async () => {
  const rows = await queryVehicles(1020, 'JEEP', 'CHEROKEE', 'ANY', 'ACTIVE');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vehicle_model, 'CHEROKEE');
});

test('BMW 3 SERIES alias query matches 330CI', async () => {
  const rows = await queryVehicles([1020, 999999], 'BMW', '3 SERIES', 'ANY', 'ACTIVE');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].yard_id, 999999);
  assert.equal(rows[0].vehicle_model, '330CI');
});

test('year range and comma-separated year parsing works through queryVehicles', async () => {
  const rows = await queryVehicles(1020, 'ANY', 'ANY', '2004-2005,2010', 'ACTIVE');
  const models = rows.map((row) => row.vehicle_model).sort();
  assert.deepEqual(models, ['CAMRY', 'CHEROKEE', 'GRAND CHEROKEE']);
});
