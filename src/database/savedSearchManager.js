const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');

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

function checkExistingSearch(userId, yardId, make, model, yearRange, status) {
  const sql = `
    SELECT 1 FROM saved_searches
    WHERE user_id = TRIM(?)
      AND yard_id = TRIM(?)
      AND UPPER(make) = UPPER(TRIM(?))
      AND UPPER(model) = UPPER(TRIM(?))
      AND year_range = TRIM(?)
      AND status = TRIM(?);
  `;
  const params = [userId, yardId, make, model, yearRange, status];

  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        console.error('SQL error checking for an existing saved search:', summarizeError(err));
        reject(err);
        return;
      }

      resolve(Boolean(row));
    });
  });
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
  let query = 'SELECT * FROM saved_searches WHERE user_id = ?';
  const params = [userId];

  if (yardId) {
    query += ' AND yard_id = ?';
    params.push(yardId);
  }

  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Failed to retrieve saved searches:', summarizeError(err));
        reject(err);
        return;
      }

      resolve(rows);
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
