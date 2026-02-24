const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
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
let db;
let setupDatabase;

test.before(async () => {
  originalCwd = process.cwd();
  previousDbPathEnv = process.env.VEHICLE_DB_PATH;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-schema-test-'));
  process.chdir(tempDir);
  process.env.VEHICLE_DB_PATH = path.join(tempDir, 'vehicleInventory.db');

  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  ({ db, setupDatabase } = require(databasePath));
  await setupDatabase();
});

test.after(async () => {
  await close(db);
  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  if (typeof previousDbPathEnv === 'string') {
    process.env.VEHICLE_DB_PATH = previousDbPathEnv;
  } else {
    delete process.env.VEHICLE_DB_PATH;
  }
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('setupDatabase creates vehicles table with expected core columns', async () => {
  const columns = await all(db, "PRAGMA table_info('vehicles');");
  const columnNames = columns.map((column) => column.name);

  assert.ok(columnNames.includes('yard_id'));
  assert.ok(columnNames.includes('vehicle_make'));
  assert.ok(columnNames.includes('vehicle_model'));
  assert.ok(columnNames.includes('vehicle_status'));
  assert.ok(columnNames.includes('session_id'));
});

test('saved_searches table includes username and yard_name columns', async () => {
  const columns = await all(db, "PRAGMA table_info('saved_searches');");
  const columnNames = columns.map((column) => column.name);

  assert.ok(columnNames.includes('username'));
  assert.ok(columnNames.includes('yard_name'));
});
