const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { sendVehicleDbFile } = require('../src/api/inventoryApiRouter');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  sqlite3,
  openDatabase,
  closeDatabase,
  get,
  all,
  createPrivateRuntimeDatabase,
  getAvailablePort,
  waitForServer,
  stopServer,
} = require('../test-support/publicInventorySnapshotHarness');

function createResponseRecorder() {
  return {
    headersSent: false,
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.headersSent = true;
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

function spawnInventoryApi(sourcePath, port) {
  return spawn(process.execPath, ['src/api/inventoryApiServer.js'], {
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
}

async function assertAccessHealthAndCors(port) {
  const unauthorizedResponse = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`);
  assert.equal(unauthorizedResponse.status, 401);

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    service: 'inventory-api',
    snapshotReady: true,
  });

  const optionsResponse = await fetch(`http://127.0.0.1:${port}/api/vehicles`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://jalopybot.com' },
  });
  assert.equal(optionsResponse.status, 204);
  assert.equal(
    optionsResponse.headers.get('access-control-allow-origin'),
    'https://jalopybot.com'
  );
}

async function downloadPublicSnapshot(port, downloadedPath) {
  const response = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`, {
    headers: { 'x-api-key': 'endpoint-test-key' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-inventory-snapshot'), 'public-vehicles-only');
  const etag = response.headers.get('etag');
  assert.ok(etag);

  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(downloadedPath, bytes, { mode: 0o600 });
  assert.equal(bytes.includes(Buffer.from('discord-user-id-that-must-never-ship')), false);
  assert.equal(bytes.includes(Buffer.from('private-discord-username')), false);
  return etag;
}

async function assertDownloadedSnapshot(downloadedPath) {
  const database = await openDatabase(downloadedPath, sqlite3.OPEN_READONLY);
  try {
    const tables = await all(
      database,
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name;`
    );
    assert.deepEqual(tables, [{ name: 'vehicles' }]);
    const vehicleCount = await get(database, 'SELECT COUNT(*) AS count FROM vehicles;');
    assert.equal(vehicleCount.count, 1);
  } finally {
    await closeDatabase(database);
  }
}

async function assertCachingAndQueryResponses(port, etag) {
  const cachedResponse = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`, {
    headers: {
      'if-none-match': etag,
      'x-api-key': 'endpoint-test-key',
    },
  });
  assert.equal(cachedResponse.status, 304);

  const headResponse = await fetch(`http://127.0.0.1:${port}/api/vehicle-db`, {
    method: 'HEAD',
    headers: { 'x-api-key': 'endpoint-test-key' },
  });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get('x-inventory-snapshot'), 'public-vehicles-only');
  assert.equal(await headResponse.text(), '');

  const queryResponse = await fetch(
    `http://127.0.0.1:${port}/api/vehicles?yard=boise&make=toyota&model=camry&year=2003&status=active`,
    { headers: { 'x-api-key': 'endpoint-test-key' } }
  );
  assert.equal(queryResponse.status, 200);
  const queryPayload = await queryResponse.json();
  assert.equal(queryPayload.count, 1);
  assert.equal(queryPayload.rows[0].make, 'TOYOTA');
  assert.equal(queryPayload.rows[0].model, 'CAMRY');

  const notFoundResponse = await fetch(`http://127.0.0.1:${port}/not-found`);
  assert.equal(notFoundResponse.status, 404);
}

test('inventory API redacts snapshot errors without changing the failure response', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-inventory.db';
  const response = createResponseRecorder();

  const consoleCalls = await captureConsole(async () => {
    await sendVehicleDbFile(
      { method: 'GET', headers: {} },
      response,
      { 'Access-Control-Allow-Origin': '*' },
      3600,
      {
        async getSnapshot() {
          throw new TypeError(privateErrorDetails);
        },
      }
    );
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), { error: 'Database snapshot not available' });
  assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
  assert.match(
    joinedConsoleText(consoleCalls),
    /failed to build public vehicle snapshot: TypeError/
  );
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('HTTP database endpoint serves the vehicles-only snapshot instead of the runtime database', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-endpoint-'));
  const sourcePath = path.join(tempDirectory, 'private-runtime.db');
  const downloadedPath = path.join(tempDirectory, 'downloaded-public.db');
  const sourceDatabase = await createPrivateRuntimeDatabase(sourcePath);
  const port = await getAvailablePort();
  const childProcess = spawnInventoryApi(sourcePath, port);

  try {
    await waitForServer(childProcess);
    await assertAccessHealthAndCors(port);
    const etag = await downloadPublicSnapshot(port, downloadedPath);
    await assertDownloadedSnapshot(downloadedPath);
    await assertCachingAndQueryResponses(port, etag);
  } finally {
    await stopServer(childProcess);
    await closeDatabase(sourceDatabase);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
