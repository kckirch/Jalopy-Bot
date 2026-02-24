const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
const managerPath = path.join(repoRoot, 'src/database/vehicleDbInventoryManager.js');

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

async function waitFor(check, timeoutMs = 2500, intervalMs = 20) {
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
let db;
let setupDatabase;
let insertOrUpdateVehicle;
let markInactiveVehicles;

test.before(async () => {
  originalCwd = process.cwd();
  previousDbPathEnv = process.env.VEHICLE_DB_PATH;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-vehicle-db-manager-test-'));
  process.chdir(tempDir);
  process.env.VEHICLE_DB_PATH = path.join(tempDir, 'vehicleInventory.db');

  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[managerPath];

  ({ db, setupDatabase } = require(databasePath));
  ({ insertOrUpdateVehicle, markInactiveVehicles } = require(managerPath));

  await setupDatabase();
});

test.beforeEach(async () => {
  await run(db, 'DELETE FROM vehicles;');
});

test.after(async () => {
  await close(db);
  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[managerPath];
  if (typeof previousDbPathEnv === 'string') {
    process.env.VEHICLE_DB_PATH = previousDbPathEnv;
  } else {
    delete process.env.VEHICLE_DB_PATH;
  }
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('insertOrUpdateVehicle inserts new vehicle as NEW with mapped yard name', async () => {
  await insertOrUpdateVehicle(1020, 'TOYOTA', 'CAMRY', 2005, 11, '', '', '20260101');

  const row = await get(
    db,
    `SELECT yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number, vehicle_status, session_id
     FROM vehicles
     WHERE yard_id = 1020 AND vehicle_make = 'TOYOTA' AND vehicle_model = 'CAMRY';`
  );

  assert.equal(row.yard_id, 1020);
  assert.equal(row.yard_name, 'BOISE');
  assert.equal(row.vehicle_year, 2005);
  assert.equal(row.row_number, 11);
  assert.equal(row.vehicle_status, 'NEW');
  assert.equal(row.session_id, '20260101');
});

test('insertOrUpdateVehicle updates existing vehicle and moves status to ACTIVE for later session', async () => {
  await insertOrUpdateVehicle(1022, 'HONDA', 'CIVIC', 2008, 44, '', '', '20260101');
  await insertOrUpdateVehicle(1022, 'HONDA', 'CIVIC', 2008, 44, '', '', '20260102');

  const updated = await get(
    db,
    "SELECT vehicle_status, session_id FROM vehicles WHERE vehicle_make = 'HONDA' AND vehicle_model = 'CIVIC';"
  );
  assert.equal(updated.vehicle_status, 'ACTIVE');
  assert.equal(updated.session_id, '20260102');
});

test('markInactiveVehicles marks only non-current session rows as INACTIVE within scoped yards', async () => {
  await run(
    db,
    `INSERT INTO vehicles (
      yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
      first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
    ) VALUES
    (1020, 'BOISE', 'FORD', 'F-150', 2010, 7, datetime('now'), datetime('now'), 'ACTIVE', datetime('now'), datetime('now'), '', '20260101'),
    (1021, 'CALDWELL', 'TOYOTA', 'TACOMA', 2012, 8, datetime('now'), datetime('now'), 'NEW', datetime('now'), datetime('now'), '', '20260102');`
  );

  await markInactiveVehicles('20260102', { yardIds: [1020, 1021] });

  await waitFor(async () => {
    const row = await get(db, "SELECT vehicle_status FROM vehicles WHERE vehicle_make = 'FORD' AND vehicle_model = 'F-150';");
    return row && row.vehicle_status === 'INACTIVE';
  });

  const inactiveRow = await get(
    db,
    "SELECT vehicle_status FROM vehicles WHERE vehicle_make = 'FORD' AND vehicle_model = 'F-150';"
  );
  const currentRow = await get(
    db,
    "SELECT vehicle_status FROM vehicles WHERE vehicle_make = 'TOYOTA' AND vehicle_model = 'TACOMA';"
  );

  assert.equal(inactiveRow.vehicle_status, 'INACTIVE');
  assert.equal(currentRow.vehicle_status, 'NEW');
});

test('markInactiveVehicles skips updates when called without scoped yard IDs', async () => {
  await run(
    db,
    `INSERT INTO vehicles (
      yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
      first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
    ) VALUES
    (1020, 'BOISE', 'MAZDA', '3', 2009, 2, datetime('now'), datetime('now'), 'ACTIVE', datetime('now'), datetime('now'), '', '20260101');`
  );

  await markInactiveVehicles('20260102');

  const row = await get(
    db,
    "SELECT vehicle_status FROM vehicles WHERE vehicle_make = 'MAZDA' AND vehicle_model = '3';"
  );
  assert.equal(row.vehicle_status, 'ACTIVE');
});
