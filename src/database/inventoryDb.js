// vehicleDbManager.js

const sqlite3 = require('sqlite3').verbose();

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

// Function to insert data into the vehicles table
function insertVehicle(yardId, make, model, year, rowNumber, firstSeen, lastSeen, status, notes) {
    const sql = `
        INSERT INTO vehicles (yard_id, vehicle_make, vehicle_model, vehicle_year, row_number, first_seen, last_seen, vehicle_status, notes, date_added, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `;
    db.run(sql, [yardId, make, model, year, rowNumber, firstSeen, lastSeen, status, notes], function(err) {
        if (err) {
            console.error('Error inserting data into vehicleInventory.db', err.message);
        } else {
            console.log(`A vehicle has been inserted with rowid ${this.lastID}`);
        }
    });
}

module.exports = { setupDatabase, insertVehicle };
