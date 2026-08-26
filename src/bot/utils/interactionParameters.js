const crypto = require('node:crypto');

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function createInteractionParameterStore({
  maxEntries = DEFAULT_MAX_ENTRIES,
  ttlMs = DEFAULT_TTL_MS,
  nowProvider = () => Date.now(),
} = {}) {
  const normalizedMaxEntries =
    Number.isInteger(maxEntries) && maxEntries > 0
      ? maxEntries
      : DEFAULT_MAX_ENTRIES;
  const normalizedTtlMs =
    Number.isInteger(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  const getCurrentTime =
    typeof nowProvider === 'function' ? nowProvider : () => Date.now();
  const entries = new Map();

  function prune() {
    const now = getCurrentTime();

    for (const [hash, entry] of entries) {
      if (!entry || entry.expiresAt <= now) {
        entries.delete(hash);
      }
    }

    while (entries.size > normalizedMaxEntries) {
      const oldestKey = entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      entries.delete(oldestKey);
    }
  }

  function store(parameters) {
    prune();
    const hash = crypto.createHash('md5').update(parameters).digest('hex');
    entries.set(hash, {
      parameters,
      expiresAt: getCurrentTime() + normalizedTtlMs,
    });
    prune();
    return hash;
  }

  function resolve(hash) {
    const entry = entries.get(hash);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= getCurrentTime()) {
      entries.delete(hash);
      return undefined;
    }
    return entry.parameters;
  }

  return Object.freeze({
    getSize: () => entries.size,
    prune,
    resolve,
    store,
  });
}

const interactionParameterStore = createInteractionParameterStore();

function storeInteractionParameters(parameters) {
  return interactionParameterStore.store(parameters);
}

function resolveInteractionParameters(hash) {
  return interactionParameterStore.resolve(hash);
}

module.exports = {
  createInteractionParameterStore,
  resolveInteractionParameters,
  storeInteractionParameters,
};
