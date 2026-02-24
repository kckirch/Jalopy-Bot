const test = require('node:test');
const assert = require('node:assert/strict');

const { getSessionID } = require('../src/bot/utils/utils');

test('getSessionID returns YYYYMMDD in UTC', () => {
  const before = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sessionID = getSessionID();
  const after = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  assert.match(sessionID, /^\d{8}$/);
  assert.ok(sessionID === before || sessionID === after);
});
