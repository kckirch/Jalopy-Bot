/**
 * vehicleDbInventoryManager.js
 * 
 * Handles database operations related to vehicle inventory for a junkyard system, including initialization, insertion, and updating of vehicle records.
 * Functions included:
 * - `insertOrUpdateVehicle(yardId, make, model, year, rowNumber, status, notes)`: Inserts a new vehicle record or updates an existing one based on provided parameters.
 * - `getYardNameById(yardId)`: Utility function to convert yard ID to a human-readable yard name.
 * 
 * This module establishes a connection to the `vehicleInventory.db` SQLite database and handles potential connection errors or SQL errors during table creation and data manipulation.
 */
const { db } = require('./database');

function resolveScrapeLogMode() {
    const value = String(process.env.SCRAPE_LOG_MODE || 'summary').trim().toLowerCase();
    return value === 'full' ? 'full' : 'summary';
}

function isFullScrapeLoggingEnabled() {
    return resolveScrapeLogMode() === 'full';
}

function logFullScrapeDetails(...args) {
    if (isFullScrapeLoggingEnabled()) {
        console.log(...args);
    }
}

function getYardNameById(yardId) {
    const yardNames = {
        1020: 'BOISE',
        1021: 'CALDWELL',
        1119: 'GARDENCITY',
        1022: 'NAMPA',
        1099: 'TWINFALLS',
        999999: 'TRUSTYPICKAPART',
    };
    return yardNames[yardId] || 'Unknown Yard';
}




function normalizeYardIds(yardIds) {
    if (!Array.isArray(yardIds)) {
        return [];
    }

    return yardIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));
}

function markInactiveVehicles(sessionID, options = {}) {
    const scopedYardIds = normalizeYardIds(options.yardIds);

    if (scopedYardIds.length === 0) {
        console.warn('markInactiveVehicles skipped: no scoped yard IDs provided.');
        return Promise.resolve();
    }

    const placeholders = scopedYardIds.map(() => '?').join(', ');
    const sql = `
        UPDATE vehicles
        SET vehicle_status = 'INACTIVE'
        WHERE session_id != ?
          AND yard_id IN (${placeholders});
    `;

    return new Promise((resolve, reject) => {
        db.run(sql, [sessionID, ...scopedYardIds], function(err) {
            if (err) {
                console.error('Error marking vehicles as INACTIVE:', err);
                reject(err);
            } else {
                console.log(`Marked ${this.changes} vehicles as INACTIVE for session ${sessionID} in yards [${scopedYardIds.join(', ')}].`);
                resolve(this.changes);
            }
        });
    });
}




function insertOrUpdateVehicle(yardId, make, model, year, rowNumber, status = '', notes, sessionID) {
    logFullScrapeDetails(`Processing vehicle: Yard ID = ${yardId}, Make = ${make}, Model = ${model}, Year = ${year}, Row = ${rowNumber}, Session ID = ${sessionID}`);
    logFullScrapeDetails(`Yard ID type: ${typeof yardId}, Yard ID value: ${yardId}`);
      
    const yardName = getYardNameById(yardId);
    if (!yardName || yardName === 'Unknown Yard') {
        console.warn(`Warning: Yard name not found for Yard ID ${yardId}`);
    }

    const findSQL = `
        SELECT id, session_id, strftime('%Y%m%d', first_seen) AS first_seen_date FROM vehicles
        WHERE yard_id = ? AND vehicle_make = ? AND vehicle_model = ? AND vehicle_year = ? AND row_number = ?
    `;

    return new Promise((resolve, reject) => {
        db.get(findSQL, [yardId, make, model, year, rowNumber], function(err, row) {
            if (err) {
                console.error('Error searching for existing vehicle:', err.message);
                reject(err);
                return;
            }

            if (row) {
                // Vehicle exists, determine the status
                let finalStatus = (row.first_seen_date === sessionID) ? 'NEW' : 'ACTIVE';

                const updateSQL = `
                    UPDATE vehicles 
                    SET vehicle_status = ?, 
                        last_seen = datetime('now'), 
                        last_updated = datetime('now'), 
                        session_id = ?
                    WHERE id = ?;
                `;
                db.run(updateSQL, [finalStatus, sessionID, row.id], function(updateErr) {
                    if (updateErr) {
                        console.error('Error updating existing vehicle with ID', row.id, ':', updateErr.message);
                        reject(updateErr);
                    } else {
                        logFullScrapeDetails(`Updated existing vehicle with ID ${row.id} to status '${finalStatus}' and session ID ${sessionID}`);
                        resolve({ action: 'updated', id: row.id, status: finalStatus });
                    }
                });
            } else {
                // New vehicle, so we insert with status 'NEW'
                const insertSQL = `
                    INSERT INTO vehicles (
                        yard_id, 
                        yard_name, 
                        vehicle_make, 
                        vehicle_model, 
                        vehicle_year, 
                        row_number, 
                        first_seen, 
                        last_seen, 
                        vehicle_status, 
                        notes, 
                        date_added, 
                        last_updated,
                        session_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'NEW', ?, datetime('now'), datetime('now'), ?)
                `;
                db.run(insertSQL, [yardId, yardName, make, model, year, rowNumber, notes, sessionID], function(insertErr) {
                    if (insertErr) {
                        console.error('Error inserting new vehicle:', insertErr.message);
                        reject(insertErr);
                    } else {
                        logFullScrapeDetails(`🆕 Inserted new vehicle: Yard ID = ${yardId}, Make = ${make}, Model = ${model}, Year = ${year}, Row = ${rowNumber}, Session ID = ${sessionID} 🆕`);
                        resolve({ action: 'inserted', id: this.lastID, status: 'NEW' });
                    }
                });
            }
        });
    });
}














module.exports = { markInactiveVehicles, insertOrUpdateVehicle };
