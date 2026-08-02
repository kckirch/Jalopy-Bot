const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUICK_ACTION_PREFIX,
  buildQuickActionCustomId,
  createInteractionParameterStore,
  resolveQuickActionPayload,
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

test('quick-action IDs round-trip reserved payload characters', () => {
  const payload = {
    uid: 'user:1',
    lc: 'Boise | North',
    yd: '1020,1021',
    mk: 'MERCEDES-BENZ',
    md: 'E CLASS / 50%',
    yr: '2000-2005',
    st: 'ACTIVE',
    sid: 123,
    idx: 2,
  };

  const customId = buildQuickActionCustomId('run', payload);
  assert.match(customId, /^sq:[a-f0-9]{32}$/);
  assert.equal(customId.startsWith(QUICK_ACTION_PREFIX), true);
  assert.deepEqual(
    resolveQuickActionPayload(customId.slice(QUICK_ACTION_PREFIX.length)),
    {
      ...payload,
      sid: '123',
      idx: '2',
      sa: 'run',
    }
  );
});

test('unknown quick-action hashes resolve as expired', () => {
  assert.equal(resolveQuickActionPayload('missing'), undefined);
});
