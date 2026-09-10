const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');
const { canonicalizeYardIdForSavedSearch, matchesSavedSearchCriteria } = require('./savedSearchCriteria');

function addSavedSearch(
  userId,
  username,
  yardId,
  yardName,
  make,
  model,
  yearRange,
  status,
  notes
) {
  const sql = `
    INSERT INTO saved_searches
      (user_id, username, yard_id, yard_name, make, model, year_range, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;
  const params = [userId, username, yardId, yardName, make, model, yearRange, status, notes];

  return new Promise((resolve, reject) => {
    db.run(sql, params, function onInsert(err) {
      if (err) {
        console.error('Error adding new saved search:', summarizeError(err));
        reject(err);
        return;
      }

      resolve(this.lastID);
    });
  });
}

async function checkExistingSearch(userId, yardId, make, model, yearRange, status) {
  const searches = await getSavedSearches(String(userId).trim());
  return searches.some((search) => matchesSavedSearchCriteria(search, {
    yardId, make, model, yearRange, status,
  }));
}

function setSavedSearchFrequency(searchId, frequency) {
  const sql = `
    UPDATE saved_searches
    SET frequency = ?, update_date = CURRENT_TIMESTAMP
    WHERE id = ?;
  `;

  return new Promise((resolve, reject) => {
    db.run(sql, [frequency, searchId], (err) => {
      if (err) {
        console.error('Error updating saved search frequency:', summarizeError(err));
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function deleteSavedSearch(searchId) {
  const sql = 'DELETE FROM saved_searches WHERE id = ?';

  return new Promise((resolve, reject) => {
    db.run(sql, [searchId], (err) => {
      if (err) {
        console.error('Error deleting saved search:', summarizeError(err));
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function getSavedSearches(userId, yardId = null) {
  const query = 'SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id';
  const params = [userId];

  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Failed to retrieve saved searches:', summarizeError(err));
        reject(err);
        return;
      }

      if (!yardId || String(yardId).trim().toUpperCase() === 'ALL') {
        resolve(rows);
        return;
      }
      const requestedYards = canonicalizeYardIdForSavedSearch(yardId).split(',');
      resolve(rows.filter((row) => {
        const savedYards = canonicalizeYardIdForSavedSearch(row.yard_id).split(',');
        return requestedYards.some((id) => savedYards.includes(id));
      }));
    });
  });
}

function getAllSavedSearches() {
  const query = 'SELECT * FROM saved_searches';

  return new Promise((resolve, reject) => {
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error('Failed to retrieve all saved searches:', summarizeError(err));
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

module.exports = {
  getSavedSearches,
  getAllSavedSearches,
  addSavedSearch,
  checkExistingSearch,
  setSavedSearchFrequency,
  deleteSavedSearch,
};
