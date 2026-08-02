const { db } = require('../database/database');

const SESSION_FRESHNESS_WINDOW_MS = 30 * 60 * 1000;
const TIME_ZONE_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parseDatabaseTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || timestamp.trim() === '') {
    return Number.NaN;
  }

  const trimmedTimestamp = timestamp.trim();
  const isoTimestamp = trimmedTimestamp.includes('T')
    ? trimmedTimestamp
    : trimmedTimestamp.replace(' ', 'T');
  const timestampWithZone = TIME_ZONE_SUFFIX_PATTERN.test(isoTimestamp)
    ? isoTimestamp
    : `${isoTimestamp}Z`;

  return Date.parse(timestampWithZone);
}

function checkSessionUpdates({ database = db, now = Date.now } = {}) {
  const sql = 'SELECT MAX(last_updated) AS lastUpdate FROM vehicles';

  return new Promise((resolve, reject) => {
    database.get(sql, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      const lastUpdateTime = parseDatabaseTimestamp(result?.lastUpdate);
      const age = now() - lastUpdateTime;
      const isRecent =
        Number.isFinite(lastUpdateTime) &&
        age >= 0 &&
        age < SESSION_FRESHNESS_WINDOW_MS;

      resolve(isRecent);
    });
  });
}

module.exports = {
  checkSessionUpdates,
};
