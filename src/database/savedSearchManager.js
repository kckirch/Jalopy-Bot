//savedSearchManager.js

const { db } = require('./database');

function addSavedSearch(userId, username, yardId, yard_name, make, model, yearRange, status, notes) {
    const sql = `
        INSERT INTO saved_searches (user_id, username, yard_id, yard_name, make, model, year_range, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    const params = [userId, username, yardId, yard_name, make, model, yearRange, status, notes];
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                console.error('Error adding new saved search:', err);
                reject(err);
            } else {
                resolve(this.lastID);
            }
        });
    });
}


function checkExistingSearch(userId, yardId, make, model, yearRange, status) {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 1 FROM saved_searches
            WHERE user_id = TRIM(?) AND yard_id = TRIM(?) AND UPPER(make) = UPPER(TRIM(?)) AND UPPER(model) = UPPER(TRIM(?)) AND year_range = TRIM(?) AND status = TRIM(?);
        `;
        const params = [userId, yardId, make, model, yearRange, status];
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error("SQL Error in checkExistingSearch:", err);
                reject(err);
            } else {
                const exists = !!row;
                resolve(exists);
            }
        });
    });
}




function setSavedSearchFrequency(searchId, frequency) {
    return new Promise((resolve, reject) => {
        const sql = `
            UPDATE saved_searches
            SET frequency = ?, update_date = CURRENT_TIMESTAMP
            WHERE id = ?;
        `;
        db.run(sql, [frequency, searchId], function(err) {
            if (err) {
                console.error('Error updating saved search frequency:', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// In your database management file
async function deleteSavedSearch(searchId) {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM saved_searches WHERE id = ?';
      db.run(sql, [searchId], function(err) {
        if (err) {
          console.error('Error deleting saved search:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
  

function getSavedSearches(userId, yardId = null) {
    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM saved_searches WHERE user_id = ?`;
      let params = [userId];
  
      if (yardId) {
        query += ` AND yard_id = ?`;
        params.push(yardId);
      }
  
      db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Failed to retrieve saved searches:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
  
  function getAllSavedSearches() {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM saved_searches`;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('Failed to retrieve all saved searches:', err);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}


module.exports = {
    getSavedSearches,
    getAllSavedSearches,
    addSavedSearch,
    checkExistingSearch,
    setSavedSearchFrequency,
    deleteSavedSearch
};
