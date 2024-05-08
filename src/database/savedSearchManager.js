//savedSearchManager.js

const { db } = require('./database');

function setupSavedSearchesTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS saved_searches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            username TEXT,
            yard_id TEXT,
            yard_name TEXT,
            make TEXT,
            model TEXT,
            year_range TEXT,
            status TEXT,
            frequency TEXT DEFAULT 'daily',
            last_notified DATETIME,
            create_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            update_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            alert_on_new BOOLEAN DEFAULT 0,
            priority INTEGER DEFAULT 0,
            notes TEXT
        );
    `;
    db.run(sql, function(err) {
        if (err) console.error('Error creating saved_searches table:', err);
        else console.log('Saved searches table created successfully');
    });
}

function addSavedSearch(userId, username, yardId, yard_name, make, model, yearRange, status, notes) {
    const sql = `
        INSERT INTO saved_searches (user_id, username, yard_id, yard_name, make, model, year_range, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;
    db.run(sql, [userId, username, yardId, yard_name, make, model, yearRange, status, notes], function(err) {
        if (err) console.error('Error adding new saved search:', err);
        else console.log('Saved search added successfully with ID:', this.lastID);
    });
}

function updateSavedSearch(id, updates) {
    // Assume updates is an object containing key-value pairs of columns to update
    const setPart = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const sql = `UPDATE saved_searches SET ${setPart} WHERE id = ?;`;
    db.run(sql, [...Object.values(updates), id], function(err) {
        if (err) console.error('Error updating saved search:', err);
        else console.log('Saved search updated successfully');
    });
}

function deleteSavedSearch(id) {
    const sql = `DELETE FROM saved_searches WHERE id = ?;`;
    db.run(sql, [id], function(err) {
        if (err) console.error('Error deleting saved search:', err);
        else console.log('Saved search deleted successfully');
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
          console.log("Retrieved saved searches successfully.");
          resolve(rows);
        }
      });
    });
  }
  


// Optionally include other functions here to handle CRUD operations for saved searches

module.exports = { setupSavedSearchesTable, getSavedSearches, addSavedSearch, updateSavedSearch, deleteSavedSearch};
