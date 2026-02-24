const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

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

test('setupDatabase migrates legacy saved_searches schema to include username and yard_name', async () => {
  const originalCwd = process.cwd();
  const previousDbPathEnv = process.env.VEHICLE_DB_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-schema-migration-test-'));
  process.chdir(tempDir);
  process.env.VEHICLE_DB_PATH = path.join(tempDir, 'vehicleInventory.db');

  const legacyDb = new sqlite3.Database(path.join(tempDir, 'vehicleInventory.db'));
  await run(
    legacyDb,
    `CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      yard_id TEXT,
      make TEXT,
      model TEXT,
      year_range TEXT,
      status TEXT,
      frequency TEXT DEFAULT 'daily',
      last_notified DATETIME,
      create_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      update_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      alert_on_new BOOLEAN DEFAULT 0,
      priority INTEGER DEFAULT 0,
      notes TEXT
    );`
  );
  await close(legacyDb);

  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  const { db, setupDatabase } = require(databasePath);

  try {
    await setupDatabase();
    const columns = await all(db, "PRAGMA table_info('saved_searches');");
    const names = columns.map((column) => column.name);

    assert.ok(names.includes('username'));
    assert.ok(names.includes('yard_name'));
  } finally {
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
  }
});
