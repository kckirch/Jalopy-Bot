const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInteractionParameterStore,
} = require('../src/bot/utils/interactionParameters');

test('interaction parameter stores enforce TTL and max-entry limits', () => {
  let now = 0;
  const store = createInteractionParameterStore({
    maxEntries: 2,
    ttlMs: 100,
    nowProvider: () => now,
  });

  const hashA = store.store('A');
  const hashB = store.store('B');
  const hashC = store.store('C');

  assert.equal(store.getSize(), 2);
  assert.equal(store.resolve(hashA), undefined);
  assert.equal(store.resolve(hashB), 'B');
  assert.equal(store.resolve(hashC), 'C');

  now = 250;
  store.prune();
  assert.equal(store.getSize(), 0);
});
