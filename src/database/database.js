// database.js
const sqlite3 = require('sqlite3').verbose();
const { VEHICLE_DB_PATH } = require('./dbPath');

const db = new sqlite3.Database(VEHICLE_DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error when connecting to the database', err);
    } else {
        console.log(`Database connection established at ${VEHICLE_DB_PATH}.`);
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

const requiredSavedSearchColumns = [
    { name: 'username', definition: 'TEXT' },
    { name: 'yard_name', definition: 'TEXT' },
];

function runSQL(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function getTableColumns(tableName) {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName});`, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

async function ensureSavedSearchColumns() {
    const columns = await getTableColumns('saved_searches');
    const existing = new Set(columns.map((column) => column.name));

    for (const column of requiredSavedSearchColumns) {
        if (!existing.has(column.name)) {
            console.log(`Adding missing saved_searches column: ${column.name}`);
            await runSQL(`ALTER TABLE saved_searches ADD COLUMN ${column.name} ${column.definition};`);
        }
    }
}

// Function to set up the database
function setupDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                await runSQL(createVehiclesTableSQL);
                console.log(`Vehicles table setup complete in ${VEHICLE_DB_PATH}`);

                await runSQL(createSavedSearchesTableSQL);
                console.log(`Saved searches table setup complete in ${VEHICLE_DB_PATH}`);

                await ensureSavedSearchColumns();

                resolve();
            } catch (error) {
                console.error('Database setup failed:', error);
                reject(error);
            }
        });
    });
}

module.exports = {
    db,
    setupDatabase
};
