const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startInventoryApiServer,
} = require('../src/api/inventoryApiServer');

test('inventory API server refuses to start without an API key', () => {
  assert.throws(
    () => startInventoryApiServer({ apiKey: '' }),
    /INVENTORY_API_KEY is required/
  );
  assert.throws(
    () => startInventoryApiServer({ apiKey: '   ' }),
    /INVENTORY_API_KEY is required/
  );
});
