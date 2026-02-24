const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
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

test('database modules use VEHICLE_DB_PATH and are not CWD-sensitive', async () => {
  const originalCwd = process.cwd();
  const previousDbPathEnv = process.env.VEHICLE_DB_PATH;

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-db-pathing-db-'));
  const unrelatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-db-pathing-cwd-'));
  const customDbPath = path.join(dbDir, 'custom-vehicle.db');

  process.env.VEHICLE_DB_PATH = customDbPath;
  process.chdir(unrelatedCwd);

  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[queryManagerPath];

  const { db, setupDatabase } = require(databasePath);
  const { queryVehicles, db: queryDb } = require(queryManagerPath);

  try {
    await setupDatabase();
    assert.equal(fs.existsSync(customDbPath), true);

    await run(
      db,
      `INSERT INTO vehicles (
        yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
        first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, datetime('now'), datetime('now'), ?, ?);`,
      [1020, 'BOISE', 'TOYOTA', 'CAMRY', 2003, 5, 'ACTIVE', '', '20260101']
    );

    const rows = await queryVehicles('ALL', 'ANY', 'ANY', 'ANY', 'ACTIVE');
    assert.ok(rows.some((row) => row.vehicle_make === 'TOYOTA' && row.vehicle_model === 'CAMRY'));
  } finally {
    await close(queryDb);
    await close(db);

    delete require.cache[dbPathModulePath];
    delete require.cache[databasePath];
    delete require.cache[queryManagerPath];

    if (typeof previousDbPathEnv === 'string') {
      process.env.VEHICLE_DB_PATH = previousDbPathEnv;
    } else {
      delete process.env.VEHICLE_DB_PATH;
    }
    process.chdir(originalCwd);
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(unrelatedCwd, { recursive: true, force: true });
  }
});
