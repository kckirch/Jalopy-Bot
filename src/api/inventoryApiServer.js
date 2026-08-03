const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { VEHICLE_DB_PATH } = require('../database/dbPath');
const { summarizeError } = require('../utils/errorSummary');
const {
  parseList,
  parsePositiveInt,
} = require('./inventoryApiQuery');
const {
  createInventoryApiRequestHandler,
} = require('./inventoryApiRouter');
const {
  createPublicInventorySnapshotProvider,
} = require('./publicInventorySnapshot');

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_DB_CACHE_SECONDS = 3600;

function requireApiKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('INVENTORY_API_KEY is required.');
  }
  return value;
}

function createSnapshotProvider(options, db, vehicleDbPath, snapshotPath) {
  if (options.snapshotProvider) return options.snapshotProvider;
  return createPublicInventorySnapshotProvider({
    sourceDatabase: db,
    sourcePath: vehicleDbPath,
    snapshotPath,
    onRefreshError: (error) => {
      console.error(
        '[inventory-api] failed to refresh public vehicle snapshot:',
        summarizeError(error)
      );
    },
  });
}

function prewarmSnapshot(snapshotProvider) {
  return Promise.resolve()
    .then(() => {
      if (typeof snapshotProvider.refreshSnapshot === 'function') {
        return snapshotProvider.refreshSnapshot();
      }
      return snapshotProvider.getSnapshot();
    })
    .then((snapshot) => {
      console.log(
        `[inventory-api] public snapshot ready with ${snapshot.vehicleCount} vehicles`
      );
    })
    .catch((error) => {
      console.error(
        '[inventory-api] failed to prewarm public vehicle snapshot:',
        summarizeError(error)
      );
    });
}

function startInventoryApiServer(options = {}) {
  const host = options.host || process.env.INVENTORY_API_HOST || DEFAULT_HOST;
  const port = parsePositiveInt(
    options.port || process.env.INVENTORY_API_PORT,
    DEFAULT_PORT
  );
  const apiKey = requireApiKey(
    options.apiKey ?? process.env.INVENTORY_API_KEY
  );
  const allowedOrigins = parseList(
    options.allowedOrigins || process.env.INVENTORY_API_ALLOWED_ORIGINS || '*'
  );
  const dbCacheSeconds = parsePositiveInt(
    options.dbCacheSeconds || process.env.INVENTORY_DB_CACHE_SECONDS,
    DEFAULT_DB_CACHE_SECONDS
  );
  const vehicleDbPath = options.dbPath || VEHICLE_DB_PATH;
  const ownsSnapshotDirectory = !options.publicSnapshotDirectory;
  const publicSnapshotDirectory =
    options.publicSnapshotDirectory ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-inventory-'));
  const snapshotPath = path.join(
    publicSnapshotDirectory,
    'vehicleInventory.db'
  );

  const db = new sqlite3.Database(
    vehicleDbPath,
    sqlite3.OPEN_READONLY,
    (error) => {
      if (error) {
        console.error(
          '[inventory-api] failed to open configured database:',
          summarizeError(error)
        );
      } else {
        console.log('[inventory-api] using configured database');
      }
    }
  );
  const snapshotProvider = createSnapshotProvider(
    options,
    db,
    vehicleDbPath,
    snapshotPath
  );
  const requestHandler = createInventoryApiRequestHandler({
    allowedOrigins,
    apiKey,
    db,
    dbCacheSeconds,
    snapshotProvider,
  });
  const server = http.createServer(requestHandler);

  server.listen(port, host, () => {
    console.log(`[inventory-api] listening on http://${host}:${port}`);
    prewarmSnapshot(snapshotProvider);
  });

  const shutdown = () => {
    server.close(() => {
      db.close(() => {
        if (ownsSnapshotDirectory) {
          fs.rmSync(publicSnapshotDirectory, { recursive: true, force: true });
        }
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  startInventoryApiServer();
}

module.exports = { startInventoryApiServer };
