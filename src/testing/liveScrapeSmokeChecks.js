const {
  formatScrapeLogValue,
  formatScrapeYardId,
} = require('../scraping/scrapeLogging');
const {
  getYardNameById,
  normalizeSessionId,
  resolveScrapeTarget,
  resolveScrapeTargets,
  selectSentinelYard,
} = require('./liveScrapeSmokeOptions');
const {
  getSQL,
  prepareSmokeDatabase,
  runSQL,
} = require('./liveScrapeSmokeRuntime');

function getJunkyardConfig(junkyards, target) {
  const config = junkyards[target.junkyardKey];
  if (!config) {
    throw new Error(`Missing junkyard config for key: ${target.junkyardKey}`);
  }
  return config;
}

function createFullScrapeOptions(config, target, sessionID) {
  return {
    ...config,
    yardId: target.yardId,
    make: 'ANY',
    model: 'ANY',
    sessionID,
    shouldMarkInactive: true,
  };
}

async function getPositiveYardRowCount(db, yardId) {
  const countRow = await getSQL(
    db,
    'SELECT COUNT(*) AS count FROM vehicles WHERE yard_id = ?;',
    [yardId]
  );
  if (!countRow || Number(countRow.count) <= 0) {
    throw new Error(
      `Smoke check failed: full scrape returned 0 rows for yard ${yardId}.`
    );
  }
  return Number(countRow.count);
}

async function runMultiYardChecks({
  args,
  logger,
  db,
  junkyards,
  convertLocationToYardId,
  getSessionID,
  universalWebScrape,
  dbFilePath,
}) {
  const targets = resolveScrapeTargets(
    args.locations,
    convertLocationToYardId
  );
  const fullSessionId = getSessionID();
  const yardCounts = [];

  for (const target of targets) {
    const junkyardConfig = getJunkyardConfig(junkyards, target);
    logger.log(
      `[smoke] Running full scrape for yard ${formatScrapeYardId(target.yardId)}...`
    );
    await universalWebScrape(
      createFullScrapeOptions(junkyardConfig, target, fullSessionId)
    );

    const count = await getPositiveYardRowCount(db, target.yardId);
    yardCounts.push({ yardId: target.yardId, count });
  }

  logger.log('[smoke] PASS: multi-yard live scrape smoke checks succeeded.');
  logger.log(
    `[smoke] Yard row counts: ${yardCounts
      .map(
        ({ yardId, count }) =>
          `${formatScrapeYardId(yardId)}=${formatScrapeLogValue(count)}`
      )
      .join(', ')}`
  );
  return { ok: true, dbFilePath, mode: 'multi-yard', yardCounts };
}

async function insertSentinel(db, targetYardId) {
  const sentinel = {
    yardId: selectSentinelYard(targetYardId),
    sessionID: '19990101',
    make: 'SMOKE_SENTINEL',
    model: 'DO_NOT_TOUCH',
  };

  await runSQL(
    db,
    `INSERT INTO vehicles (
      yard_id, yard_name, vehicle_make, vehicle_model, vehicle_year, row_number,
      first_seen, last_seen, vehicle_status, date_added, last_updated, notes, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, datetime('now'), datetime('now'), ?, ?);`,
    [
      sentinel.yardId,
      getYardNameById(sentinel.yardId),
      sentinel.make,
      sentinel.model,
      1999,
      9999,
      'ACTIVE',
      'smoke sentinel',
      sentinel.sessionID,
    ]
  );

  return sentinel;
}

async function assertSentinelUnchanged(db, sentinel) {
  const sentinelRow = await getSQL(
    db,
    `SELECT vehicle_status, session_id
     FROM vehicles
     WHERE yard_id = ? AND vehicle_make = ? AND vehicle_model = ?;`,
    [sentinel.yardId, sentinel.make, sentinel.model]
  );
  if (!sentinelRow) {
    throw new Error('Smoke check failed: sentinel row missing after partial scrape.');
  }
  if (sentinelRow.vehicle_status !== 'ACTIVE') {
    throw new Error(
      `Smoke check failed: sentinel row status changed to ${sentinelRow.vehicle_status}.`
    );
  }
  if (sentinelRow.session_id !== sentinel.sessionID) {
    throw new Error(
      `Smoke check failed: sentinel session changed to ${sentinelRow.session_id}.`
    );
  }
}

async function assertNoInactiveRowsForSession(db, sessionID) {
  const countRow = await getSQL(
    db,
    `SELECT COUNT(*) AS count
     FROM vehicles
     WHERE session_id = ? AND vehicle_status = 'INACTIVE';`,
    [sessionID]
  );
  if (Number(countRow.count) > 0) {
    throw new Error(
      `Smoke check failed: found ${countRow.count} INACTIVE rows for current partial session.`
    );
  }
}

async function runSingleYardChecks({
  args,
  logger,
  db,
  junkyards,
  convertLocationToYardId,
  getSessionID,
  universalWebScrape,
  dbFilePath,
}) {
  const target = resolveScrapeTarget(
    args.location,
    convertLocationToYardId
  );
  const junkyardConfig = getJunkyardConfig(junkyards, target);
  logger.log(`[smoke] Target yard: ${formatScrapeYardId(target.yardId)}`);

  const fullSessionId = getSessionID();
  const partialSessionId = normalizeSessionId(fullSessionId);

  logger.log('[smoke] Running full scrape (ANY/ANY)...');
  await universalWebScrape(
    createFullScrapeOptions(junkyardConfig, target, fullSessionId)
  );

  const fullCount = await getPositiveYardRowCount(db, target.yardId);
  logger.log(
    `[smoke] Full scrape row count for yard ${formatScrapeYardId(target.yardId)}: ${formatScrapeLogValue(fullCount)}`
  );

  const sentinel = await insertSentinel(db, target.yardId);
  logger.log('[smoke] Running filtered partial scrape...');
  await universalWebScrape({
    ...junkyardConfig,
    yardId: target.yardId,
    make: String(args.make || 'TOYOTA').toUpperCase(),
    model: String(args.model || 'CAMRY').toUpperCase(),
    sessionID: partialSessionId,
    shouldMarkInactive: false,
  });

  await assertSentinelUnchanged(db, sentinel);
  await assertNoInactiveRowsForSession(db, partialSessionId);

  logger.log('[smoke] PASS: live scrape smoke checks succeeded.');
  return { ok: true, dbFilePath };
}

async function executeSmokeChecks(context) {
  const { args, dbFilePath, logger, setupDatabase } = context;
  await prepareSmokeDatabase(dbFilePath, setupDatabase);
  logger.log('[smoke] Using isolated database.');

  if (Array.isArray(args.locations) && args.locations.length > 0) {
    logger.log(`[smoke] Multi-yard mode count: ${args.locations.length}`);
    return runMultiYardChecks(context);
  }

  logger.log('[smoke] Single-yard mode.');
  return runSingleYardChecks(context);
}

module.exports = {
  executeSmokeChecks,
};
