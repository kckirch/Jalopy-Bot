const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatScrapeLogValue } = require('../scraping/scrapeLogging');

const SMOKE_ENVIRONMENT_KEYS = Object.freeze([
  'VEHICLE_DB_PATH',
  'SCRAPER_ENGINE',
  'CHROMEDRIVER_PATH',
]);

function resolveSmokeDatabasePath(
  args,
  { now = Date.now, osModule = os, pathModule = path } = {}
) {
  return args.dbPath
    ? pathModule.resolve(args.dbPath)
    : pathModule.join(osModule.tmpdir(), `jalopy-live-smoke-${now()}.db`);
}

function activateSmokeEnvironment(args, dbFilePath, env = process.env) {
  const snapshot = Object.fromEntries(
    SMOKE_ENVIRONMENT_KEYS.map((key) => [key, env[key]])
  );

  env.VEHICLE_DB_PATH = dbFilePath;
  if (args.engine) {
    env.SCRAPER_ENGINE = args.engine;
  }

  return snapshot;
}

function restoreSmokeEnvironment(snapshot, env = process.env) {
  for (const key of SMOKE_ENVIRONMENT_KEYS) {
    if (typeof snapshot[key] === 'string') {
      env[key] = snapshot[key];
    } else {
      delete env[key];
    }
  }
}

function runSQL(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve(this);
    });
  });
}

function getSQL(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) return reject(error);
      resolve(row);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

async function prepareSmokeDatabase(
  dbFilePath,
  setupDatabase,
  fsModule = fs
) {
  fsModule.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  await setupDatabase();
}

function cleanupSmokeDatabase(
  { dbFilePath, keepDb },
  logger,
  fsModule = fs
) {
  if (keepDb) {
    logger.log(
      `[smoke] Kept isolated DB at: ${formatScrapeLogValue(dbFilePath, {
        maxLength: 160,
      })}`
    );
    return;
  }

  if (fsModule.existsSync(dbFilePath)) {
    fsModule.rmSync(dbFilePath, { force: true });
  }
}

module.exports = {
  activateSmokeEnvironment,
  cleanupSmokeDatabase,
  closeDatabase,
  getSQL,
  prepareSmokeDatabase,
  resolveSmokeDatabasePath,
  restoreSmokeEnvironment,
  runSQL,
};
