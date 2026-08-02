const SAFE_ERROR_NAME = /^(?:Error|[A-Za-z][A-Za-z0-9_.-]{0,58}Error)$/;
const SAFE_ERROR_CODE = /^(?:[A-Z][A-Z0-9_.-]{0,63}|\d{1,6})$/;

function normalizeToken(value, pattern) {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim();
  return pattern.test(token) ? token : null;
}

function summarizeError(error) {
  // Messages and stacks can contain identities, SQL values, and local paths.
  // Keep only conventional error identifiers with strict length and shape limits.
  const name = normalizeToken(error?.name, SAFE_ERROR_NAME) || 'Error';
  const code = normalizeToken(error?.code, SAFE_ERROR_CODE);

  return code ? `${name} [${code}]` : name;
}

module.exports = { summarizeError };
