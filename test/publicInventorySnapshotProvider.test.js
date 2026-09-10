const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildPublicInventorySnapshot,
} = require('../src/api/publicInventorySnapshotBuilder');
const {
  createPublicInventorySnapshotProvider,
} = require('../src/api/publicInventorySnapshot');
const {
  sqlite3,
  openDatabase,
  closeDatabase,
  run,
  get,
  insertVehicle,
  createPrivateRuntimeDatabase,
} = require('../test-support/publicInventorySnapshotHarness');

test('snapshot provider refreshes the public database after committed source changes', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-provider-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
  const snapshotPath = path.join(tempDirectory, 'public', 'inventory.db');
  const writerDatabase = await createPrivateRuntimeDatabase(sourcePath);
  const readerDatabase = await openDatabase(sourcePath, sqlite3.OPEN_READONLY);
  const provider = createPublicInventorySnapshotProvider({
    sourceDatabase: readerDatabase,
    sourcePath,
    snapshotPath,
  });

  try {
    const firstSnapshot = await provider.getSnapshot();
    assert.equal(firstSnapshot.vehicleCount, 1);

    await insertVehicle(writerDatabase, {
      yardId: 1021,
      yardName: 'CALDWELL',
      make: 'HONDA',
      model: 'CIVIC',
      year: 2005,
      rowNumber: 8,
      status: 'NEW',
    });

    const secondSnapshot = await provider.refreshSnapshot();
    assert.equal(secondSnapshot.vehicleCount, 2);
    assert.notEqual(secondSnapshot.dataVersion, firstSnapshot.dataVersion);

    const snapshotDatabase = await openDatabase(snapshotPath, sqlite3.OPEN_READONLY);
    const count = await get(snapshotDatabase, 'SELECT COUNT(*) AS count FROM vehicles;');
    await closeDatabase(snapshotDatabase);
    assert.equal(count.count, 2);
  } finally {
    await closeDatabase(readerDatabase);
    await closeDatabase(writerDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('snapshot provider serves the last good snapshot while refreshing in the background', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-stale-provider-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
  const snapshotPath = path.join(tempDirectory, 'public', 'inventory.db');
  const writerDatabase = await createPrivateRuntimeDatabase(sourcePath);
  const readerDatabase = await openDatabase(sourcePath, sqlite3.OPEN_READONLY);
  let signalSecondBuildStarted = () => {};
  const secondBuildStarted = new Promise((resolve) => {
    signalSecondBuildStarted = resolve;
  });
  let buildCount = 0;
  let continueSecondBuild;
  const secondBuildCanContinue = new Promise((resolve) => {
    continueSecondBuild = resolve;
  });
  const provider = createPublicInventorySnapshotProvider({
    sourceDatabase: readerDatabase,
    sourcePath,
    snapshotPath,
    buildSnapshot: async (...args) => {
      buildCount += 1;
      if (buildCount === 2) {
        signalSecondBuildStarted();
        await secondBuildCanContinue;
      }
      return buildPublicInventorySnapshot(...args);
    },
  });

  try {
    const firstSnapshot = await provider.getSnapshot();
    assert.equal(firstSnapshot.vehicleCount, 1);

    await insertVehicle(writerDatabase, {
      yardId: 1021,
      yardName: 'CALDWELL',
      make: 'HONDA',
      model: 'CIVIC',
      year: 2005,
      rowNumber: 8,
      firstSeen: '2026-07-31',
      lastSeen: '2026-07-31',
      status: 'NEW',
      dateAdded: '2026-07-31',
      lastUpdated: '2026-07-31',
      sessionId: '20260731',
    });

    const staleSnapshot = await provider.getSnapshot();
    assert.equal(staleSnapshot.vehicleCount, 1);
    await secondBuildStarted;

    const concurrentStaleSnapshot = await provider.getSnapshot();
    assert.equal(concurrentStaleSnapshot, staleSnapshot);
    assert.equal(buildCount, 2);

    const staleDatabase = await openDatabase(snapshotPath, sqlite3.OPEN_READONLY);
    const staleCount = await get(staleDatabase, 'SELECT COUNT(*) AS count FROM vehicles;');
    await closeDatabase(staleDatabase);
    assert.equal(staleCount.count, 1);

    continueSecondBuild();
    const refreshedSnapshot = await provider.refreshSnapshot();
    assert.equal(refreshedSnapshot.vehicleCount, 2);
    assert.equal(buildCount, 2);
  } finally {
    continueSecondBuild();
    await closeDatabase(readerDatabase);
    await closeDatabase(writerDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('snapshot provider reports a failed background refresh and keeps serving good data', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-refresh-error-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
  const snapshotPath = path.join(tempDirectory, 'public', 'inventory.db');
  const writerDatabase = await createPrivateRuntimeDatabase(sourcePath);
  const readerDatabase = await openDatabase(sourcePath, sqlite3.OPEN_READONLY);
  let buildCount = 0;
  let reportRefreshError;
  const refreshErrorReported = new Promise((resolve) => {
    reportRefreshError = resolve;
  });
  const provider = createPublicInventorySnapshotProvider({
    sourceDatabase: readerDatabase,
    sourcePath,
    snapshotPath,
    buildSnapshot: async (...args) => {
      buildCount += 1;
      if (buildCount === 2) {
        throw new Error('simulated background refresh failure');
      }
      return buildPublicInventorySnapshot(...args);
    },
    onRefreshError(error) {
      reportRefreshError(error);
      throw new Error('simulated reporting failure');
    },
  });

  try {
    const firstSnapshot = await provider.getSnapshot();
    assert.equal(firstSnapshot.vehicleCount, 1);

    await run(writerDatabase, "UPDATE vehicles SET vehicle_status = 'INACTIVE' WHERE id = 1;");

    const staleSnapshot = await provider.getSnapshot();
    assert.equal(staleSnapshot.vehicleCount, 1);
    const refreshError = await refreshErrorReported;
    assert.match(refreshError.message, /simulated background refresh failure/);
    assert.equal(fs.existsSync(staleSnapshot.path), true);

    const recoveredSnapshot = await provider.refreshSnapshot();
    assert.equal(recoveredSnapshot.vehicleCount, 1);
    assert.equal(buildCount, 3);
  } finally {
    await closeDatabase(readerDatabase);
    await closeDatabase(writerDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('snapshot provider rejects an invalid SQLite data version', async () => {
  const sourceDatabase = {
    get(_sql, _params, callback) {
      callback(null, { data_version: 'not-an-integer' });
    },
  };
  const provider = createPublicInventorySnapshotProvider({
    sourceDatabase,
    sourcePath: '/private/runtime.db',
    snapshotPath: '/public/inventory.db',
  });

  await assert.rejects(provider.getSnapshot(), /Unable to read SQLite data_version/);
});

test('snapshot provider propagates SQLite read errors without starting a build', async () => {
  const database = await openDatabase(':memory:');
  await closeDatabase(database);
  const provider = createPublicInventorySnapshotProvider({
    sourceDatabase: database,
    buildSnapshot: async () => assert.fail('a failed read must not start a build'),
  });

  await assert.rejects(provider.getSnapshot(), { code: 'SQLITE_MISUSE' });
  await assert.rejects(provider.refreshSnapshot(), { code: 'SQLITE_MISUSE' });
  await assert.rejects(closeDatabase(database), { code: 'SQLITE_MISUSE' });
});
