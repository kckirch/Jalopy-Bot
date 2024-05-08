// database.js
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./vehicleInventory.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error when connecting to the database', err);
    } else {
        console.log('Database connection established.');
    }
});

// SQL commands to create tables
const createVehiclesTableSQL = `
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

const createSavedSearchesTableSQL = `
    CREATE TABLE IF NOT EXISTS saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        yard_id TEXT,
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

// Function to set up the database
function setupDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(createVehiclesTableSQL, err => {
                if (err) {
                    console.error('Error creating vehicles table in vehicleInventory.db', err);
                    return reject(err);
                }
                console.log('Vehicles table setup complete in vehicleInventory.db');
            });

            db.run(createSavedSearchesTableSQL, err => {
                if (err) {
                    console.error('Error creating saved_searches table in vehicleInventory.db', err);
                    return reject(err);
                }
                console.log('Saved searches table setup complete in vehicleInventory.db');
            });

            resolve(); // Resolve the promise after all tables are set up
        });
    });
}

module.exports = {
    db,
    setupDatabase
};
