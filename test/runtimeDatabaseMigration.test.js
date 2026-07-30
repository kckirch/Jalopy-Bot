const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const {
  migrateLegacyDatabase,
  resolveMigrationTarget,
  validateSqliteDatabase,
} = require('../src/database/runtimeDatabaseMigration');

function openDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(database);
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function get(database, sql) {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

test('migrateLegacyDatabase creates a healthy external snapshot and never overwrites it', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-runtime-db-migration-'));
  const sourcePath = path.join(tempDirectory, 'legacy.db');
  const targetPath = path.join(tempDirectory, 'runtime', 'vehicleInventory.db');
  const sourceDatabase = await openDatabase(sourcePath);

  try {
    await run(sourceDatabase, 'PRAGMA journal_mode = WAL;');
    await run(sourceDatabase, 'CREATE TABLE vehicles (id INTEGER PRIMARY KEY, make TEXT NOT NULL);');
    await run(sourceDatabase, 'CREATE TABLE saved_searches (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL);');
    await run(sourceDatabase, 'INSERT INTO vehicles (make) VALUES (?);', ['TOYOTA']);

    const migration = await migrateLegacyDatabase({ sourcePath, targetPath });
    assert.equal(migration.status, 'migrated');
    assert.equal(fs.existsSync(sourcePath), true);
    assert.equal(fs.existsSync(targetPath), true);
    assert.equal(fs.statSync(targetPath).mode & 0o777, 0o600);
    await validateSqliteDatabase(targetPath);

    const targetDatabase = await openDatabase(targetPath);
    const migratedRow = await get(targetDatabase, 'SELECT make FROM vehicles WHERE id = 1;');
    await closeDatabase(targetDatabase);
    assert.deepEqual(migratedRow, { make: 'TOYOTA' });

    await run(sourceDatabase, 'INSERT INTO vehicles (make) VALUES (?);', ['HONDA']);
    const secondMigration = await migrateLegacyDatabase({ sourcePath, targetPath });
    assert.equal(secondMigration.status, 'already-exists');

    const unchangedTarget = await openDatabase(targetPath);
    const targetCount = await get(unchangedTarget, 'SELECT COUNT(*) AS count FROM vehicles;');
    await closeDatabase(unchangedTarget);
    assert.equal(targetCount.count, 1);
  } finally {
    await closeDatabase(sourceDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('migration path validation rejects ambiguous or checkout-local targets', async () => {
  assert.throws(
    () => resolveMigrationTarget({ VEHICLE_DB_PATH: 'relative/vehicleInventory.db' }),
    /must be an absolute path/
  );

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-runtime-db-safety-'));
  const sourcePath = path.join(tempDirectory, 'legacy.db');
  const sourceDatabase = await openDatabase(sourcePath);

  try {
    await run(sourceDatabase, 'CREATE TABLE vehicles (id INTEGER PRIMARY KEY);');
    await run(sourceDatabase, 'CREATE TABLE saved_searches (id INTEGER PRIMARY KEY);');
  } finally {
    await closeDatabase(sourceDatabase);
  }

  try {
    await assert.rejects(
      migrateLegacyDatabase({ sourcePath, targetPath: sourcePath }),
      /must differ from the legacy tracked database path/
    );

    await assert.rejects(
      migrateLegacyDatabase({
        repositoryRoot: tempDirectory,
        sourcePath,
        targetPath: path.join(tempDirectory, 'runtime.db'),
      }),
      /must be outside the Git checkout/
    );

    const emptyTargetPath = path.join(tempDirectory, 'empty-target.db');
    fs.writeFileSync(emptyTargetPath, '');
    await assert.rejects(
      migrateLegacyDatabase({ sourcePath, targetPath: emptyTargetPath }),
      /missing or empty/
    );
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
