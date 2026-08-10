const { db } = require('../database/database');
const { YARDS } = require('../config/yards');
const { getSessionID } = require('../utils/sessionId');

const DEFAULT_EXPECTED_YARD_IDS = Object.freeze(YARDS.map((yard) => yard.id));

function normalizeYardIds(yardIds) {
  if (!Array.isArray(yardIds)) return [];

  return [...new Set(yardIds.map(Number).filter(Number.isInteger))];
}

function checkSessionUpdates({
  database = db,
  sessionID = getSessionID(),
  expectedYardIds = DEFAULT_EXPECTED_YARD_IDS,
} = {}) {
  const yardIds = normalizeYardIds(expectedYardIds);
  if (!sessionID || yardIds.length === 0) return Promise.resolve(false);

  const placeholders = yardIds.map(() => '?').join(', ');
  const sql = `
    SELECT COUNT(DISTINCT yard_id) AS coveredYardCount
    FROM vehicles
    WHERE session_id = ?
      AND yard_id IN (${placeholders})
  `;

  return new Promise((resolve, reject) => {
    database.get(sql, [String(sessionID), ...yardIds], (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(Number(result?.coveredYardCount) === yardIds.length);
    });
  });
}

module.exports = {
  checkSessionUpdates,
};
