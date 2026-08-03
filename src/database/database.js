const sqlite3 = require('sqlite3').verbose();
const { VEHICLE_DB_PATH } = require('./dbPath');
const { summarizeError } = require('../utils/errorSummary');

let db;
const databaseReady = new Promise((resolve, reject) => {
  db = new sqlite3.Database(
    VEHICLE_DB_PATH,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    (error) => {
      if (error) {
        console.error(
          'Error when connecting to the database:',
          summarizeError(error)
        );
        reject(error);
        return;
      }

      console.log('Database connection established.');
      resolve();
    }
  );
});

const CREATE_VEHICLES_TABLE_SQL = `
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

const CREATE_SAVED_SEARCHES_TABLE_SQL = `
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

const REQUIRED_SAVED_SEARCH_COLUMNS = [
  { name: 'username', definition: 'TEXT' },
  { name: 'yard_name', definition: 'TEXT' },
];

function runSQL(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve(this);
    });
  });
}

function getSavedSearchColumns() {
  return new Promise((resolve, reject) => {
    db.all("PRAGMA table_info('saved_searches');", (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows || []);
    });
  });
}

async function ensureSavedSearchColumns() {
  const columns = await getSavedSearchColumns();
  const existingColumns = new Set(columns.map((column) => column.name));

  for (const column of REQUIRED_SAVED_SEARCH_COLUMNS) {
    if (!existingColumns.has(column.name)) {
      console.log(`Adding missing saved_searches column: ${column.name}`);
      await runSQL(
        `ALTER TABLE saved_searches ADD COLUMN ${column.name} ${column.definition};`
      );
    }
  }
}

async function setupDatabase() {
  try {
    await databaseReady;
    await runSQL(CREATE_VEHICLES_TABLE_SQL);
    console.log('Vehicles table setup complete.');

    await runSQL(CREATE_SAVED_SEARCHES_TABLE_SQL);
    console.log('Saved searches table setup complete.');

    await ensureSavedSearchColumns();
  } catch (error) {
    console.error('Database setup failed:', summarizeError(error));
    throw error;
  }
}

module.exports = {
  db,
  setupDatabase,
};
