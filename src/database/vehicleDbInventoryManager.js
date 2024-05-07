/**
 * vehicleDbInventoryManager.js
 * 
 * Handles database operations related to vehicle inventory for a junkyard system, including initialization, insertion, and updating of vehicle records.
 * Functions included:
 * - `setupDatabase()`: Initializes and creates the vehicle table if it doesn't exist, preparing the database for use.
 * - `insertOrUpdateVehicle(yardId, make, model, year, rowNumber, status, notes)`: Inserts a new vehicle record or updates an existing one based on provided parameters.
 * - `getYardNameById(yardId)`: Utility function to convert yard ID to a human-readable yard name.
 * 
 * This module establishes a connection to the `vehicleInventory.db` SQLite database and handles potential connection errors or SQL errors during table creation and data manipulation.
 */


const sqlite3 = require('sqlite3').verbose();

function getYardNameById(yardId) {
    const yardMapping = {
        1020: 'BOISE',
        1021: 'CALDWELL',
        1119: 'GARDENCITY',
        1022: 'NAMPA',
        1099: 'TWINFALLS'
    };
    return yardMapping[yardId] || 'Unknown';
}



function markInactiveVehicles(sessionID) {
    const sql = `
        UPDATE vehicles
        SET vehicle_status = 'Inactive'
        WHERE session_id != ?;
    `;
    db.run(sql, [sessionID], function(err) {
        if (err) {
            console.error('Error marking vehicles as inactive:', err);
        } else {
            console.log(`Vehicles not seen on ${sessionID} have been marked as inactive.`);
        }
    });
}




// Initialize the database connection to a file named vehicleInventory.db
const db = new sqlite3.Database('./vehicleInventory.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error when connecting to the database', err);
    } else {
        console.log('Database connection established to vehicleInventory.db');
    }
});

// Function to set up the database table
function setupDatabase() {
    return new Promise((resolve, reject) => {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS vehicles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                yard_id INTEGER,
                yard_name TEXT,
                vehicle_make TEXT,
                vehicle_model TEXT,
                vehicle_year INTEGER,
                row_number INTEGER,
                first_seen TEXT,
                last_seen TEXT,
                vehicle_status TEXT,
                date_added TEXT,
                last_updated TEXT,
                notes TEXT,
                session_id TEXT
            );
        `;
        db.run(createTableSQL, (err) => {
            if (err) {
                console.error('Error creating vehicles table in vehicleInventory.db', err);
                reject(err);
            } else {
                console.log('Vehicles table setup complete in vehicleInventory.db');
                resolve();
            }
        });
    });
}



function insertOrUpdateVehicle(yardId, make, model, year, rowNumber, status = '', notes, sessionID) {
    // console.log(`Inserting or updating vehicle with session ID: ${sessionID}`);

    const yardName = getYardNameById(yardId);
    const findSQL = `
        SELECT id, session_id, strftime('%Y%m%d', first_seen) AS first_seen_date FROM vehicles
        WHERE yard_id = ? AND vehicle_make = ? AND vehicle_model = ? AND vehicle_year = ? AND row_number = ?
    `;
    db.get(findSQL, [yardId, make, model, year, rowNumber], function(err, row) {
        if (err) {
            console.error('Error searching for existing vehicle', err.message);
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
            db.run(updateSQL, [finalStatus, sessionID, row.id], function(err) {
                if (err) {
                    console.error('Error updating existing vehicle:', err.message);
                } else {
                    console.log(`Updated existing vehicle with ID ${row.id} to status ${finalStatus} and session ID ${sessionID}`);
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
            db.run(insertSQL, [yardId, yardName, make, model, year, rowNumber, notes,sessionID], function(err) {
                if (err) {
                    console.error('Error inserting new vehicle', err.message);
                } else {
                    console.log(`🆕Inserted new vehicle with status 'NEW' and session ID ${sessionID}🆕`);
                }
            });
        }
    });
}













module.exports = { markInactiveVehicles, setupDatabase, insertOrUpdateVehicle };
