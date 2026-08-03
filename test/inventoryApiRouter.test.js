const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInventoryApiRequestHandler,
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
