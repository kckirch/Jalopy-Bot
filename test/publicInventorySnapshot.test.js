const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();
const {
  buildPublicInventorySnapshot,
  createPublicInventorySnapshotProvider,
} = require('../src/api/publicInventorySnapshot');

function openDatabase(databasePath, mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, mode, (error) => {
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

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function waitForServer(childProcess) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Inventory API did not start in time.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      childProcess.stdout.off('data', onStdout);
      childProcess.stderr.off('data', onStderr);
      childProcess.off('exit', onExit);
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('[inventory-api] listening on')) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Inventory API exited before listening (code=${code}, signal=${signal}).\nstderr: ${stderr}`
        )
      );
    };

    childProcess.stdout.on('data', onStdout);
    childProcess.stderr.on('data', onStderr);
    childProcess.once('exit', onExit);
  });
}

function stopServer(childProcess) {
  return new Promise((resolve) => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      childProcess.kill('SIGKILL');
    }, 5000);
    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    childProcess.kill('SIGTERM');
  });
}

async function createPrivateRuntimeDatabase(databasePath) {
  const database = await openDatabase(databasePath);
  await run(database, 'PRAGMA journal_mode = WAL;');
  await run(
    database,
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
  await run(
    database,
    `CREATE TABLE saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      username TEXT,
      model TEXT
    );`
  );
  await run(
    database,
    `INSERT INTO vehicles (
      yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
      first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      1020,
      'BOISE',
      'TOYOTA',
      'CAMRY',
      2003,
      5,
      '2026-07-30',
      '2026-07-30',
      'ACTIVE',
      '2026-07-30',
      '2026-07-30',
      '',
      '20260730',
    ]
  );
  await run(
    database,
    'INSERT INTO saved_searches (user_id, username, model) VALUES (?, ?, ?);',
    ['discord-user-id-that-must-never-ship', 'private-discord-username', 'CAMRY']
  );
  return database;
}

test('public inventory snapshot contains vehicles and no private saved-search data', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-snapshot-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
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

    await run(
      writerDatabase,
      `INSERT INTO vehicles (
        yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
        first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        1021,
        'CALDWELL',
        'HONDA',
        'CIVIC',
        2005,
        8,
        '2026-07-30',
        '2026-07-30',
        'NEW',
        '2026-07-30',
        '2026-07-30',
        '',
        '20260730',
      ]
    );

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

    await run(
      writerDatabase,
      `INSERT INTO vehicles (
        yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
        first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        1021,
        'CALDWELL',
        'HONDA',
        'CIVIC',
        2005,
        8,
        '2026-07-31',
        '2026-07-31',
        'NEW',
        '2026-07-31',
        '2026-07-31',
        '',
        '20260731',
      ]
    );

    const staleSnapshot = await provider.getSnapshot();
    assert.equal(staleSnapshot.vehicleCount, 1);
    await secondBuildStarted;

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
    onRefreshError: reportRefreshError,
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

test('HTTP database endpoint serves the vehicles-only snapshot instead of the runtime database', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-endpoint-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
  const downloadedPath = path.join(tempDirectory, 'downloaded-public.db');
  const sourceDatabase = await createPrivateRuntimeDatabase(sourcePath);
  const port = await getAvailablePort();
  const childProcess = spawn(process.execPath, ['src/api/inventoryApiServer.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      VEHICLE_DB_PATH: sourcePath,
      INVENTORY_API_HOST: '127.0.0.1',
      INVENTORY_API_PORT: String(port),
      INVENTORY_API_KEY: 'endpoint-test-key',
      INVENTORY_API_ALLOWED_ORIGINS: 'https://jalopybot.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let downloadedDatabase;

  try {
    await waitForServer(childProcess);
    const unauthorizedResponse = await fetch(
      `http://127.0.0.1:${port}/api/vehicle-db`
    );
    assert.equal(unauthorizedResponse.status, 401);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      service: 'inventory-api',
    });

    const optionsResponse = await fetch(`http://127.0.0.1:${port}/api/vehicles`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://jalopybot.com',
      },
    });
    assert.equal(optionsResponse.status, 204);
    assert.equal(
      optionsResponse.headers.get('access-control-allow-origin'),
      'https://jalopybot.com'
    );

    const response = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`, {
      headers: {
        'x-api-key': 'endpoint-test-key',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-inventory-snapshot'), 'public-vehicles-only');
    const etag = response.headers.get('etag');
    assert.ok(etag);

    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(downloadedPath, bytes, { mode: 0o600 });
    assert.equal(bytes.includes(Buffer.from('discord-user-id-that-must-never-ship')), false);
    assert.equal(bytes.includes(Buffer.from('private-discord-username')), false);

    downloadedDatabase = await openDatabase(downloadedPath, sqlite3.OPEN_READONLY);
    const tables = await all(
      downloadedDatabase,
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name;`
    );
    assert.deepEqual(tables, [{ name: 'vehicles' }]);
    const vehicleCount = await get(
      downloadedDatabase,
      'SELECT COUNT(*) AS count FROM vehicles;'
    );
    assert.equal(vehicleCount.count, 1);

    const cachedResponse = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`, {
      headers: {
        'if-none-match': etag,
        'x-api-key': 'endpoint-test-key',
      },
    });
    assert.equal(cachedResponse.status, 304);

    const headResponse = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`, {
      method: 'HEAD',
      headers: {
        'x-api-key': 'endpoint-test-key',
      },
    });
    assert.equal(headResponse.status, 200);
    assert.equal(headResponse.headers.get('x-inventory-snapshot'), 'public-vehicles-only');
    assert.equal(await headResponse.text(), '');

    const queryResponse = await fetch(
      `http://127.0.0.1:${port}/api/vehicles?yard=boise&make=toyota&model=camry&year=2003&status=active`,
      {
        headers: {
          'x-api-key': 'endpoint-test-key',
        },
      }
    );
    assert.equal(queryResponse.status, 200);
    const queryPayload = await queryResponse.json();
    assert.equal(queryPayload.count, 1);
    assert.equal(queryPayload.rows[0].make, 'TOYOTA');
    assert.equal(queryPayload.rows[0].model, 'CAMRY');

    const notFoundResponse = await fetch(`http://127.0.0.1:${port}/not-found`);
    assert.equal(notFoundResponse.status, 404);
  } finally {
    if (downloadedDatabase) {
      await closeDatabase(downloadedDatabase);
    }
    await stopServer(childProcess);
    await closeDatabase(sourceDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
