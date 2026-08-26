const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { YARDS } = require('../config/yards');
const { summarizeError } = require('../utils/errorSummary');

const USAGE = 'Usage: npm run smoke:live -- [--location boise]';

function parseLocation(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return null;
  if (argv.length === 0) return 'boise';
  if (argv.length !== 2 || argv[0] !== '--location' || !argv[1]) {
    throw new Error(USAGE);
  }
  return argv[1].trim().toLowerCase();
}

function resolveYard(location) {
  const yard = YARDS.find(({ slug }) => slug === location);
  if (!yard) throw new Error(`Unknown smoke-test location: ${location}`);
  return yard;
}

function getVehicleCount(db, yardId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT COUNT(*) AS count FROM vehicles WHERE yard_id = ?;',
      [yardId],
      (error, row) => error ? reject(error) : resolve(Number(row?.count || 0))
    );
  });
}

function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

async function runLiveScrapeSmokeTest(argv = process.argv.slice(2)) {
  const location = parseLocation(argv);
  if (!location) {
    console.log(USAGE);
    return;
  }

  const yard = resolveYard(location);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'jalopy-live-smoke-')
  );
  const originalDatabasePath = process.env.VEHICLE_DB_PATH;
  process.env.VEHICLE_DB_PATH = path.join(temporaryDirectory, 'inventory.db');

  let db;
  try {
    const junkyards = require('../config/junkyards');
    const database = require('../database/database');
    const { scrapeWithHttp } = require('../scraping/httpInventoryScrape');
    const { getSessionID } = require('../utils/sessionId');
    db = database.db;

    await database.setupDatabase();
    await scrapeWithHttp({
      ...junkyards[yard.junkyardKey],
      yardId: yard.id,
      make: 'ANY',
      model: 'ANY',
      sessionID: getSessionID(),
      shouldMarkInactive: true,
    });

    const count = await getVehicleCount(db, yard.id);
    if (count === 0) throw new Error('Live scrape returned no vehicles.');
    console.log(`[smoke] PASS: ${yard.displayName} returned ${count} vehicles.`);
  } finally {
    if (db) await closeDatabase(db);
    if (originalDatabasePath === undefined) delete process.env.VEHICLE_DB_PATH;
    else process.env.VEHICLE_DB_PATH = originalDatabasePath;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runLiveScrapeSmokeTest().catch((error) => {
    console.error('[smoke] FAIL:', summarizeError(error));
    process.exitCode = 1;
  });
}

module.exports = { parseLocation, resolveYard, runLiveScrapeSmokeTest };
