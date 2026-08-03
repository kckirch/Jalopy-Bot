function normalizeYardId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const yardId = Number(normalized);
  return Number.isSafeInteger(yardId) && yardId > 0 ? yardId : null;
}

module.exports = { normalizeYardId };
