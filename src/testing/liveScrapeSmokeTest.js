const { summarizeError } = require('../utils/errorSummary');
const { executeSmokeChecks } = require('./liveScrapeSmokeChecks');
const {
  getUsageText,
  normalizeSessionId,
  parseArgs,
  resolveScrapeTarget,
  resolveScrapeTargets,
  selectSentinelYard,
} = require('./liveScrapeSmokeOptions');
const {
  activateSmokeEnvironment,
  cleanupSmokeDatabase,
  closeDatabase,
  resolveSmokeDatabasePath,
  restoreSmokeEnvironment,
} = require('./liveScrapeSmokeRuntime');

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

  const dbFilePath = resolveSmokeDatabasePath(args);
  const environmentSnapshot = activateSmokeEnvironment(args, dbFilePath);
  const {
    junkyards = require('../config/junkyards'),
    convertLocationToYardId = require('../bot/utils/locationUtils')
      .convertLocationToYardId,
    getSessionID = require('../utils/sessionId').getSessionID,
    universalWebScrape = require('../scraping/universalWebScrape')
      .universalWebScrape,
    databaseModule = require('../database/database'),
  } = deps;
  const { setupDatabase, db } = databaseModule;

  let smokeResult;
  let smokeError = null;
  let closeError = null;

  try {
    smokeResult = await executeSmokeChecks({
      args,
      dbFilePath,
      logger,
      db,
      setupDatabase,
      junkyards,
      convertLocationToYardId,
      getSessionID,
      universalWebScrape,
    });
  } catch (error) {
    smokeError = error;
  } finally {
    try {
      await closeDatabase(db);
    } catch (error) {
      closeError = error;
      logger.error(
        'Failed to close smoke-test DB cleanly:',
        summarizeError(error)
      );
    }

    cleanupSmokeDatabase({ dbFilePath, keepDb: args.keepDb }, logger);
    restoreSmokeEnvironment(environmentSnapshot);
  }

  if (smokeError) throw smokeError;
  if (closeError) throw closeError;
  return smokeResult;
}

async function runLiveScrapeSmokeCli(run = runLiveScrapeSmokeTest) {
  try {
    await run();
  } catch (error) {
    const message = String((error && error.message) || error || '');
    if (message.includes('chromedriver') && message.includes('ENOENT')) {
      console.error('[smoke] Chromedriver not found.');
      console.error(
        '[smoke] Install chromedriver and ensure it is in PATH, or set CHROMEDRIVER_PATH.'
      );
      console.error(
        '[smoke] Example (Homebrew): brew install --cask chromedriver'
      );
    } else if (
      message.includes('requires axios') ||
      message.includes('requires cheerio')
    ) {
      console.error('[smoke] Missing HTTP scraper dependencies.');
      console.error('[smoke] Run: npm install');
    }
    console.error('[smoke] FAIL:', summarizeError(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runLiveScrapeSmokeCli();
}

module.exports = {
  parseArgs,
  resolveScrapeTarget,
  resolveScrapeTargets,
  runLiveScrapeSmokeTest,
  runLiveScrapeSmokeCli,
  __testables: {
    normalizeSessionId,
    selectSentinelYard,
    getUsageText,
  },
};
