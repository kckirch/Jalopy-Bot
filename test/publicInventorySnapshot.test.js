const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildPublicInventorySnapshot,
} = require('../src/api/publicInventorySnapshotBuilder');
const {
  sqlite3,
  openDatabase,
  closeDatabase,
  get,
  all,
  createPrivateRuntimeDatabase,
} = require('../test-support/publicInventorySnapshotHarness');

test('public inventory snapshot contains vehicles and no private saved-search data', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-snapshot-'));
  const sourcePath = path.join(tempDirectory, 'private runtime #1.db');
  const snapshotPath = path.join(tempDirectory, 'public', 'inventory.db');
  const sourceDatabase = await createPrivateRuntimeDatabase(sourcePath);
  let snapshotDatabase;

  try {
    const result = await buildPublicInventorySnapshot(sourcePath, snapshotPath);
    assert.equal(result.vehicleCount, 1);
    assert.equal(fs.existsSync(snapshotPath), true);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(snapshotPath).mode & 0o777, 0o600);
    }

    snapshotDatabase = await openDatabase(snapshotPath, sqlite3.OPEN_READONLY);
    const tables = await all(
      snapshotDatabase,
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name;`
    );
    assert.deepEqual(tables, [{ name: 'vehicles' }]);

    const indexes = await all(
      snapshotDatabase,
      `SELECT name
       FROM sqlite_master
       WHERE type = 'index' AND tbl_name = 'vehicles' AND sql IS NOT NULL
       ORDER BY name;`
    );
    assert.deepEqual(indexes, [{ name: 'idx_vehicles_make_model' }]);

    const vehicle = await get(
      snapshotDatabase,
      'SELECT vehicle_make AS make, vehicle_model AS model FROM vehicles WHERE id = 1;'
    );
    assert.deepEqual(vehicle, { make: 'TOYOTA', model: 'CAMRY' });

    const integrity = await get(snapshotDatabase, 'PRAGMA quick_check;');
    assert.deepEqual(integrity, { quick_check: 'ok' });

    const snapshotBytes = fs.readFileSync(snapshotPath);
    assert.equal(snapshotBytes.includes(Buffer.from('discord-user-id-that-must-never-ship')), false);
    assert.equal(snapshotBytes.includes(Buffer.from('private-discord-username')), false);

    const privateSearchCount = await get(
      sourceDatabase,
      'SELECT COUNT(*) AS count FROM saved_searches;'
    );
    assert.equal(privateSearchCount.count, 1);
  } finally {
    if (snapshotDatabase) {
      await closeDatabase(snapshotDatabase);
    }
    await closeDatabase(sourceDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('snapshot build does not create a missing source or replace the last good snapshot', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-missing-source-'));
  const sourcePath = path.join(tempDirectory, 'missing private #1.db');
  const snapshotDirectory = path.join(tempDirectory, 'public');
  const snapshotPath = path.join(snapshotDirectory, 'inventory.db');
  const lastGoodSnapshot = Buffer.from('last-good-public-snapshot');
  fs.mkdirSync(snapshotDirectory);
  fs.writeFileSync(snapshotPath, lastGoodSnapshot, { mode: 0o600 });

  try {
    await assert.rejects(
      buildPublicInventorySnapshot(sourcePath, snapshotPath),
      /unable to open database/
    );

    assert.equal(fs.existsSync(sourcePath), false);
    assert.deepEqual(fs.readFileSync(snapshotPath), lastGoodSnapshot);
    assert.deepEqual(fs.readdirSync(snapshotDirectory), ['inventory.db']);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('snapshot build preserves the last good snapshot when the source is corrupt', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-corrupt-source-'));
  const sourcePath = path.join(tempDirectory, 'corrupt-private.db');
  const snapshotDirectory = path.join(tempDirectory, 'public');
  const snapshotPath = path.join(snapshotDirectory, 'inventory.db');
  const lastGoodSnapshot = Buffer.from('last-good-public-snapshot');
  fs.mkdirSync(snapshotDirectory);
  fs.writeFileSync(sourcePath, 'this is not a SQLite database');
  fs.writeFileSync(snapshotPath, lastGoodSnapshot, { mode: 0o600 });

  try {
    await assert.rejects(
      buildPublicInventorySnapshot(sourcePath, snapshotPath),
      /file is not a database/
    );

    assert.deepEqual(fs.readFileSync(snapshotPath), lastGoodSnapshot);
    assert.deepEqual(fs.readdirSync(snapshotDirectory), ['inventory.db']);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('snapshot build refuses to replace the private runtime database in place', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-same-snapshot-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
  const sourceDatabase = await createPrivateRuntimeDatabase(sourcePath);

  try {
    await assert.rejects(
      buildPublicInventorySnapshot(sourcePath, sourcePath),
      /snapshot path must differ/
    );
    const vehicleCount = await get(sourceDatabase, 'SELECT COUNT(*) AS count FROM vehicles;');
    assert.equal(vehicleCount.count, 1);
    assert.deepEqual(fs.readdirSync(tempDirectory).sort(), [
      'private-runtime.db',
      'private-runtime.db-shm',
      'private-runtime.db-wal',
    ]);
  } finally {
    await closeDatabase(sourceDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
