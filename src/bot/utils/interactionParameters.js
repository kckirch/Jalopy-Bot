const crypto = require('node:crypto');

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const QUICK_ACTION_PREFIX = 'sq:';

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

function encodeParamValue(value) {
  return encodeURIComponent(String(value ?? ''));
}

function decodeParamValue(value) {
  try {
    return decodeURIComponent(String(value ?? ''));
  } catch (error) {
    return String(value ?? '');
  }
}

function serializeActionPayload(payload) {
  return Object.entries(payload)
    .map(([key, value]) => `${key}:${encodeParamValue(value)}`)
    .join('|');
}

function deserializeActionPayload(serializedPayload) {
  return String(serializedPayload || '')
    .split('|')
    .reduce((accumulator, pair) => {
      const separatorIndex = pair.indexOf(':');
      if (separatorIndex === -1) {
        return accumulator;
      }

      const key = pair.slice(0, separatorIndex);
      const value = pair.slice(separatorIndex + 1);
      accumulator[key] = decodeParamValue(value);
      return accumulator;
    }, {});
}

function buildQuickActionCustomId(action, payload) {
  const serialized = serializeActionPayload({
    ...payload,
    sa: action,
  });
  const hash = storeInteractionParameters(serialized);
  return `${QUICK_ACTION_PREFIX}${hash}`;
}

function resolveQuickActionPayload(hash) {
  const serializedPayload = resolveInteractionParameters(hash);
  if (!serializedPayload) {
    return undefined;
  }
  return deserializeActionPayload(serializedPayload);
}

module.exports = {
  QUICK_ACTION_PREFIX,
  buildQuickActionCustomId,
  createInteractionParameterStore,
  resolveInteractionParameters,
  resolveQuickActionPayload,
  storeInteractionParameters,
};
