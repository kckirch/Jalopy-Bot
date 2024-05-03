// vehicleDbManager.js

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
                notes TEXT
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

function runDbQueryWithRetry(sql, params, callback, retries = 5) {
    db.run(sql, params, function(err) {
        if (err && err.code === 'SQLITE_BUSY' && retries > 0) {
            console.log('SQLITE_BUSY encountered, retrying...');
            setTimeout(() => {
                runDbQueryWithRetry(sql, params, callback, retries - 1);
            }, 100); // Retry after 100 ms
        } else {
            callback(err, this);
        }
    });
}

function insertOrUpdateVehicle(yardId, make, model, year, rowNumber, status = '', notes) {
    const yardName = getYardNameById(yardId);
    const findSQL = `
        SELECT id FROM vehicles
        WHERE yard_id = ? AND vehicle_make = ? AND vehicle_model = ? AND vehicle_year = ? AND row_number = ?
    `;
    db.get(findSQL, [yardId, make, model, year, rowNumber], function(err, row) {
        if (err) {
            console.error('Error searching for existing vehicle', err.message);
            return;
        }
        if (row) {
            // Vehicle exists, use passed status or default to 'Active' if no status provided
            const finalStatus = status || 'Active';
            const updateSQL = `
                UPDATE vehicles 
                SET vehicle_status = ?, 
                    last_seen = datetime('now'), 
                    last_updated = datetime('now') 
                WHERE id = ?;
            `;
            db.run(updateSQL, [finalStatus, row.id], function(err) {
                if (err) {
                    console.error('Error updating existing vehicle', err.message);
                } else {
                    console.log(`Updated existing vehicle with ID ${row.id} to status ${finalStatus}`);
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
                    last_updated
                )
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'NEW', ?, datetime('now'), datetime('now'))
            `;
            db.run(insertSQL, [yardId, yardName, make, model, year, rowNumber, notes], function(err) {
                if (err) {
                    console.error('Error inserting new vehicle', err.message);
                } else {
                    console.log(`Inserted new vehicle with status 'NEW'`);
                }
            });
        }
    });
}













module.exports = { setupDatabase, insertOrUpdateVehicle };
