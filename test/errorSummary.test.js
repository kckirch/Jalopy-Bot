const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeError } = require('../src/utils/errorSummary');

test('summarizeError keeps the error type without its message or stack', () => {
  const error = new TypeError('private-user /home/kc/private-file');

  const summary = summarizeError(error);

  assert.equal(summary, 'TypeError');
  assert.equal(summary.includes(error.message), false);
  assert.equal(summary.includes('/home/kc'), false);
});

test('summarizeError keeps a bounded machine-readable error code', () => {
  assert.equal(
    summarizeError({ name: 'DiscordAPIError', code: '50013' }),
    'DiscordAPIError [50013]'
  );
  assert.equal(
    summarizeError({ name: 'Error', code: 'SQLITE_CONSTRAINT' }),
    'Error [SQLITE_CONSTRAINT]'
  );
});

test('summarizeError rejects untrusted names and codes', () => {
  const summary = summarizeError({
    name: 'private-user',
    code: '111111111111111111',
  });

  assert.equal(summary, 'Error');
});
