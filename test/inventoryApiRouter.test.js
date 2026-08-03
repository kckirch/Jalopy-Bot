const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createInventoryApiRequestHandler,
  sendVehicleDbFile,
} = require('../src/api/inventoryApiRouter');

function createResponse() {
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

function createRequestHandler() {
  return createInventoryApiRequestHandler({
    allowedOrigins: ['*'],
    apiKey: '',
    db: {},
    dbCacheSeconds: 3600,
    snapshotProvider: {},
  });
}

test('inventory API ignores an invalid Host header when routing origin-form requests', () => {
  const response = createResponse();

  assert.doesNotThrow(() => {
    createRequestHandler()(
      { method: 'GET', url: '/health', headers: { host: '%' } },
      response
    );
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    service: 'inventory-api',
  });
});

test('inventory API returns a bounded 400 response for a malformed request target', () => {
  const response = createResponse();

  createRequestHandler()(
    { method: 'GET', url: 'http://[', headers: {} },
    response
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
  assert.deepEqual(JSON.parse(response.body), { error: 'Bad request' });
});

test('inventory API fails closed when its API key is missing', () => {
  let queryCalled = false;
  const response = createResponse();
  const handler = createInventoryApiRequestHandler({
    allowedOrigins: ['*'],
    apiKey: '',
    db: {
      all() {
        queryCalled = true;
      },
    },
    dbCacheSeconds: 3600,
    snapshotProvider: {},
  });

  handler(
    { method: 'GET', url: '/api/vehicles', headers: {} },
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: 'Unauthorized' });
  assert.equal(queryCalled, false);
});

test('inventory API accepts only the exact configured API key', () => {
  let queryCount = 0;
  const handler = createInventoryApiRequestHandler({
    allowedOrigins: ['*'],
    apiKey: 'exact-test-key',
    db: {
      all(_sql, _params, callback) {
        queryCount += 1;
        callback(null, []);
      },
    },
    dbCacheSeconds: 3600,
    snapshotProvider: {},
  });
  const wrongKeyResponse = createResponse();
  const exactKeyResponse = createResponse();

  handler(
    {
      method: 'GET',
      url: '/api/vehicles',
      headers: { 'x-api-key': 'exact-test-key-with-extra-data' },
    },
    wrongKeyResponse
  );
  handler(
    {
      method: 'GET',
      url: '/api/vehicles',
      headers: { 'x-api-key': 'exact-test-key' },
    },
    exactKeyResponse
  );

  assert.equal(wrongKeyResponse.statusCode, 401);
  assert.equal(exactKeyResponse.statusCode, 200);
  assert.equal(queryCount, 1);
});

test('a mismatched ETag takes precedence over If-Modified-Since', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-etag-precedence-'));
  const snapshotPath = path.join(tempDirectory, 'inventory.db');
  fs.writeFileSync(snapshotPath, 'public snapshot');
  const response = createResponse();

  try {
    await sendVehicleDbFile(
      {
        method: 'HEAD',
        headers: {
          'if-none-match': 'W/"different-snapshot"',
          'if-modified-since': 'Wed, 01 Jan 2100 00:00:00 GMT',
        },
      },
      response,
      {},
      3600,
      { async getSnapshot() { return { path: snapshotPath }; } }
    );

    assert.equal(response.statusCode, 200);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('If-Modified-Since uses the whole-second precision of Last-Modified', async () => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-modified-since-'));
  const snapshotPath = path.join(tempDirectory, 'inventory.db');
  fs.writeFileSync(snapshotPath, 'public snapshot');
  const mtime = new Date('2026-08-03T12:00:00.789Z');
  fs.utimesSync(snapshotPath, mtime, mtime);
  const snapshotProvider = {
    async getSnapshot() {
      return { path: snapshotPath };
    },
  };
  const initialResponse = createResponse();
  const conditionalResponse = createResponse();

  try {
    await sendVehicleDbFile(
      { method: 'HEAD', headers: {} },
      initialResponse,
      {},
      3600,
      snapshotProvider
    );
    await sendVehicleDbFile(
      {
        method: 'HEAD',
        headers: {
          'if-modified-since': initialResponse.headers['Last-Modified'],
        },
      },
      conditionalResponse,
      {},
      3600,
      snapshotProvider
    );

    assert.equal(initialResponse.statusCode, 200);
    assert.equal(conditionalResponse.statusCode, 304);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
