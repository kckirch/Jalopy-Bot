const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {
    location: 'boise',
    locations: null,
    make: 'TOYOTA',
    model: 'CAMRY',
    engine: null,
    dbPath: null,
    keepDb: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--location') {
      args.location = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--locations') {
      const raw = String(argv[i + 1] || '').trim();
      args.locations = raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--make') {
      args.make = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--model') {
      args.model = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--engine') {
      args.engine = String(argv[i + 1] || '').trim().toLowerCase();
      i += 1;
    } else if (arg === '--db-path') {
      args.dbPath = String(argv[i + 1] || '').trim();
      i += 1;
    } else if (arg === '--keep-db') {
      args.keepDb = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function getUsageText() {
  return [
    'Usage: node src/testing/liveScrapeSmokeTest.js [options]',
    '',
    'Options:',
    '  --location <location>   Yard location (default: boise)',
    '  --locations <a,b>       Multi-yard smoke locations (e.g. boise,caldwell)',
    '  --make <make>           Partial scrape make (default: TOYOTA)',
    '  --model <model>         Partial scrape model (default: CAMRY)',
    '  --engine <mode>         Scraper engine: auto|selenium|http (default: env/auto)',
    '  --db-path <path>        Explicit isolated DB path (default: temp file)',
    '  --keep-db               Keep isolated DB after run',
    '  --help, -h              Show this help',
  ].join('\n');
}

function normalizeSessionId(sessionId) {
  const asNumber = Number(sessionId);
  if (Number.isNaN(asNumber)) return `${sessionId}1`;
  return String(asNumber + 1);
}

function resolveScrapeTarget(location, convertLocationToYardId) {
  const normalizedLocation = String(location || '').trim().toLowerCase();

  if (normalizedLocation === 'trustypickapart') {
    return { junkyardKey: 'trustyJunkyard', yardId: 999999 };
  }

  const yardId = convertLocationToYardId(normalizedLocation);
  if (yardId === 'ALL' || Array.isArray(yardId)) {
    throw new Error('Smoke test requires a single concrete location, not ALL or grouped locations.');
  }

  return { junkyardKey: 'jalopyJungle', yardId: Number(yardId) };
}

function resolveScrapeTargets(locations, convertLocationToYardId) {
  return locations.map((location) => resolveScrapeTarget(location, convertLocationToYardId));
}

function getYardNameById(yardId) {
  const mapping = {
    1020: 'BOISE',
    1021: 'CALDWELL',
    1022: 'NAMPA',
    1099: 'TWINFALLS',
    1119: 'GARDENCITY',
    999999: 'TRUSTYPICKAPART',
  };
  return mapping[yardId] || `YARD_${yardId}`;
}

function selectSentinelYard(targetYardId) {
  const candidates = [1020, 1021, 1022, 1099, 1119, 999999];
  const found = candidates.find((yardId) => yardId !== Number(targetYardId));
  if (!found) {
    throw new Error('Unable to find sentinel yard ID for smoke validation.');
  }
  return found;
}

function runSQL(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getSQL(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function ensureSmokeChromedriverPath(logger = console) {
  const configuredPath = String(process.env.CHROMEDRIVER_PATH || '').trim();
  if (configuredPath) {
    return null;
  }

  try {
    const bundledChromedriver = require('chromedriver');
    const bundledPath = bundledChromedriver && bundledChromedriver.path;
    if (bundledPath) {
      process.env.CHROMEDRIVER_PATH = bundledPath;
      logger.log(`[smoke] Defaulted CHROMEDRIVER_PATH to bundled driver: ${bundledPath}`);
      return bundledPath;
    }
  } catch (error) {
    // Fall back to resolver behavior when bundled dependency is unavailable.
  }

  return null;
}

async function runLiveScrapeSmokeTest({
  argv = process.argv.slice(2),
  logger = console,
  deps = {},
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    logger.log(getUsageText());
    return { ok: true, skipped: true };
  }

  const dbFilePath = args.dbPath
    ? path.resolve(args.dbPath)
    : path.join(os.tmpdir(), `jalopy-live-smoke-${Date.now()}.db`);

  const previousDbPath = process.env.VEHICLE_DB_PATH;
  const previousScraperEngine = process.env.SCRAPER_ENGINE;
  const previousChromedriverPath = process.env.CHROMEDRIVER_PATH;
  process.env.VEHICLE_DB_PATH = dbFilePath;
  if (args.engine) {
    process.env.SCRAPER_ENGINE = args.engine;
  }
  const effectiveEngine = String(process.env.SCRAPER_ENGINE || 'auto').trim().toLowerCase();
  if (effectiveEngine !== 'http') {
    ensureSmokeChromedriverPath(logger);
  }

  const {
    junkyards = require('../config/junkyards'),
    convertLocationToYardId = require('../bot/utils/locationUtils').convertLocationToYardId,
    getSessionID = require('../bot/utils/utils').getSessionID,
    universalWebScrape = require('../scraping/universalWebScrape').universalWebScrape,
    databaseModule = require('../database/database'),
  } = deps;

  const { setupDatabase, db } = databaseModule;

  let closeError = null;

  try {
    fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

    await setupDatabase();
    logger.log(`[smoke] Using isolated DB: ${dbFilePath}`);
    if (Array.isArray(args.locations) && args.locations.length > 0) {
      logger.log(`[smoke] Multi-yard mode locations: ${args.locations.join(', ')}`);
    } else {
      logger.log(`[smoke] Target location: ${args.location} (single-yard mode)`);
    }

    if (Array.isArray(args.locations) && args.locations.length > 0) {
      const targets = resolveScrapeTargets(args.locations, convertLocationToYardId);
      const fullSessionId = getSessionID();
      const yardCounts = [];

      for (const target of targets) {
        const junkyardConfig = junkyards[target.junkyardKey];
        if (!junkyardConfig) {
          throw new Error(`Missing junkyard config for key: ${target.junkyardKey}`);
        }

        logger.log(`[smoke] Running full scrape (ANY/ANY) for ${target.yardId}...`);
        await universalWebScrape({
          ...junkyardConfig,
          yardId: target.yardId,
          make: 'ANY',
          model: 'ANY',
          sessionID: fullSessionId,
          shouldMarkInactive: true,
        });

        const fullCountRow = await getSQL(
          db,
          'SELECT COUNT(*) AS count FROM vehicles WHERE yard_id = ?;',
          [target.yardId]
        );
        if (!fullCountRow || Number(fullCountRow.count) <= 0) {
          throw new Error(`Smoke check failed: full scrape returned 0 rows for yard ${target.yardId}.`);
        }

        yardCounts.push({ yardId: target.yardId, count: Number(fullCountRow.count) });
      }

      logger.log('[smoke] PASS: multi-yard live scrape smoke checks succeeded.');
      logger.log(`[smoke] Yard row counts: ${yardCounts.map((item) => `${item.yardId}=${item.count}`).join(', ')}`);
      return { ok: true, dbFilePath, mode: 'multi-yard', yardCounts };
    }

    const target = resolveScrapeTarget(args.location, convertLocationToYardId);
    const junkyardConfig = junkyards[target.junkyardKey];
    if (!junkyardConfig) {
      throw new Error(`Missing junkyard config for key: ${target.junkyardKey}`);
    }
    logger.log(`[smoke] Target location: ${args.location} (yard ${target.yardId})`);

    const fullSessionId = getSessionID();
    const partialSessionId = normalizeSessionId(fullSessionId);

    const fullOptions = {
      ...junkyardConfig,
      yardId: target.yardId,
      make: 'ANY',
      model: 'ANY',
      sessionID: fullSessionId,
      shouldMarkInactive: true,
    };

    logger.log('[smoke] Running full scrape (ANY/ANY)...');
    await universalWebScrape(fullOptions);

    const fullCountRow = await getSQL(
      db,
      'SELECT COUNT(*) AS count FROM vehicles WHERE yard_id = ?;',
      [target.yardId]
    );
    if (!fullCountRow || Number(fullCountRow.count) <= 0) {
      throw new Error(`Smoke check failed: full scrape returned 0 rows for yard ${target.yardId}.`);
    }
    logger.log(`[smoke] Full scrape row count for yard ${target.yardId}: ${fullCountRow.count}`);

    const sentinelYardId = selectSentinelYard(target.yardId);
    const sentinelSession = '19990101';
    const sentinelMake = 'SMOKE_SENTINEL';
    const sentinelModel = 'DO_NOT_TOUCH';

    await runSQL(
      db,
      `INSERT INTO vehicles (
        yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
        first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, datetime('now'), datetime('now'), ?, ?);`,
      [sentinelYardId, getYardNameById(sentinelYardId), sentinelMake, sentinelModel, 1999, 9999, 'ACTIVE', 'smoke sentinel', sentinelSession]
    );

    const partialOptions = {
      ...junkyardConfig,
      yardId: target.yardId,
      make: String(args.make || 'TOYOTA').toUpperCase(),
      model: String(args.model || 'CAMRY').toUpperCase(),
      sessionID: partialSessionId,
      shouldMarkInactive: false,
    };

    logger.log(`[smoke] Running partial scrape (${partialOptions.make}/${partialOptions.model})...`);
    await universalWebScrape(partialOptions);

    const sentinelRow = await getSQL(
      db,
      `SELECT vehicle_status, session_id
       FROM vehicles
       WHERE yard_id = ? AND vehicle_make = ? AND vehicle_model = ?;`,
      [sentinelYardId, sentinelMake, sentinelModel]
    );
    if (!sentinelRow) {
      throw new Error('Smoke check failed: sentinel row missing after partial scrape.');
    }
    if (sentinelRow.vehicle_status !== 'ACTIVE') {
      throw new Error(`Smoke check failed: sentinel row status changed to ${sentinelRow.vehicle_status}.`);
    }
    if (sentinelRow.session_id !== sentinelSession) {
      throw new Error(`Smoke check failed: sentinel session changed to ${sentinelRow.session_id}.`);
    }

    const badCurrentSessionRows = await getSQL(
      db,
      `SELECT COUNT(*) AS count
       FROM vehicles
       WHERE session_id = ? AND vehicle_status = 'INACTIVE';`,
      [partialSessionId]
    );
    if (Number(badCurrentSessionRows.count) > 0) {
      throw new Error(`Smoke check failed: found ${badCurrentSessionRows.count} INACTIVE rows for current partial session.`);
    }

    logger.log('[smoke] PASS: live scrape smoke checks succeeded.');
    return { ok: true, dbFilePath };
  } finally {
    try {
      await closeDb(db);
    } catch (err) {
      closeError = err;
      logger.error('Failed to close smoke-test DB cleanly:', err);
    }

    if (args.keepDb) {
      logger.log(`[smoke] Kept isolated DB at: ${dbFilePath}`);
    } else if (fs.existsSync(dbFilePath)) {
      fs.rmSync(dbFilePath, { force: true });
    }

    if (typeof previousDbPath === 'string') {
      process.env.VEHICLE_DB_PATH = previousDbPath;
    } else {
      delete process.env.VEHICLE_DB_PATH;
    }

    if (typeof previousScraperEngine === 'string') {
      process.env.SCRAPER_ENGINE = previousScraperEngine;
    } else {
      delete process.env.SCRAPER_ENGINE;
    }

    if (typeof previousChromedriverPath === 'string') {
      process.env.CHROMEDRIVER_PATH = previousChromedriverPath;
    } else {
      delete process.env.CHROMEDRIVER_PATH;
    }

    if (closeError) {
      throw closeError;
    }
  }
}

if (require.main === module) {
  runLiveScrapeSmokeTest().catch((error) => {
    const message = String((error && error.message) || error || '');
    if (message.includes('chromedriver') && message.includes('ENOENT')) {
      console.error('[smoke] Chromedriver not found.');
      console.error('[smoke] Install chromedriver and ensure it is in PATH, or set CHROMEDRIVER_PATH.');
      console.error('[smoke] Example (Homebrew): brew install --cask chromedriver');
    } else if (message.includes('requires axios') || message.includes('requires cheerio')) {
      console.error('[smoke] Missing HTTP scraper dependencies.');
      console.error('[smoke] Run: npm install');
    }
    console.error('[smoke] FAIL:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  resolveScrapeTarget,
  resolveScrapeTargets,
  runLiveScrapeSmokeTest,
  __testables: {
    normalizeSessionId,
    selectSentinelYard,
    getUsageText,
    ensureSmokeChromedriverPath,
  },
};
