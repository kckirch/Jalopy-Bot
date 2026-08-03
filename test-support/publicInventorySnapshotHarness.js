const net = require('node:net');
const sqlite3 = require('sqlite3').verbose();

const DEFAULT_VEHICLE = Object.freeze({
  yardId: 1020,
  yardName: 'BOISE',
  make: 'TOYOTA',
  model: 'CAMRY',
  year: 2003,
  rowNumber: 5,
  firstSeen: '2026-07-30',
  lastSeen: '2026-07-30',
  status: 'ACTIVE',
  dateAdded: '2026-07-30',
  lastUpdated: '2026-07-30',
  notes: '',
  sessionId: '20260730',
});

function openDatabase(databasePath, mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, mode, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(database);
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

async function insertVehicle(database, overrides = {}) {
  const vehicle = { ...DEFAULT_VEHICLE, ...overrides };
  await run(
    database,
    `INSERT INTO vehicles (
      yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
      first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      vehicle.yardId,
      vehicle.yardName,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.rowNumber,
      vehicle.firstSeen,
      vehicle.lastSeen,
      vehicle.status,
      vehicle.dateAdded,
      vehicle.lastUpdated,
      vehicle.notes,
      vehicle.sessionId,
    ]
  );
}

async function createPrivateRuntimeDatabase(databasePath) {
  const database = await openDatabase(databasePath);
  await run(database, 'PRAGMA journal_mode = WAL;');
  await run(
    database,
    `CREATE TABLE vehicles (
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
    );`
  );
  await run(
    database,
    `CREATE TABLE saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      username TEXT,
      model TEXT
    );`
  );
  await run(
    database,
    'CREATE INDEX idx_vehicles_make_model ON vehicles(vehicle_make, vehicle_model);'
  );
  await insertVehicle(database);
  await run(
    database,
    'INSERT INTO saved_searches (user_id, username, model) VALUES (?, ?, ?);',
    ['discord-user-id-that-must-never-ship', 'private-discord-username', 'CAMRY']
  );
  return database;
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function waitForServer(childProcess) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Inventory API did not start in time.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      childProcess.stdout.off('data', onStdout);
      childProcess.stderr.off('data', onStderr);
      childProcess.off('exit', onExit);
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('[inventory-api] listening on')) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Inventory API exited before listening (code=${code}, signal=${signal}).\nstderr: ${stderr}`
        )
      );
    };

    childProcess.stdout.on('data', onStdout);
    childProcess.stderr.on('data', onStderr);
    childProcess.once('exit', onExit);
  });
}

function stopServer(childProcess) {
  return new Promise((resolve) => {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      childProcess.kill('SIGKILL');
    }, 5000);
    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    childProcess.kill('SIGTERM');
  });
}

module.exports = {
  sqlite3,
  openDatabase,
  closeDatabase,
  run,
  get,
  all,
  insertVehicle,
  createPrivateRuntimeDatabase,
  getAvailablePort,
  waitForServer,
  stopServer,
};
