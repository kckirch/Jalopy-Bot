const { summarizeError } = require('../utils/errorSummary');
const { normalizeYardId } = require('./yardIdNormalization');
const { logScrapeRequest } = require('./scrapeLogging');

function createScrapeRun(upsertVehicle, { now = Date.now } = {}) {
  const startedAt = now();
  const scrapedYardIds = new Set();
  let scrapeSucceeded = false;
  let upsertCount = 0;

  return {
    startedAt,
    async upsertVehicle(...args) {
      await upsertVehicle(...args);
      upsertCount += 1;
    },
    trackYard(yardId) {
      const normalizedYardId = normalizeYardId(yardId);
      if (normalizedYardId !== null) {
        scrapedYardIds.add(normalizedYardId);
      }
    },
    markSucceeded() {
      scrapeSucceeded = true;
    },
    getState() {
      return {
        scrapeSucceeded,
        scrapedYardIds: [...scrapedYardIds],
        upsertCount,
      };
    },
  };
}

async function reconcileScrapeRun(
  run,
  options,
  reconcileInactiveVehicles,
  { hadSoftFailure = false } = {}
) {
  const state = run.getState();
  try {
    if (
      options.shouldMarkInactive === true &&
      state.scrapeSucceeded &&
      !hadSoftFailure &&
      state.scrapedYardIds.length > 0 &&
      state.upsertCount > 0
    ) {
      await reconcileInactiveVehicles(options.sessionID, {
        yardIds: state.scrapedYardIds,
      });
      return;
    }

    console.log(
      `Skipping inactive reconciliation. shouldMarkInactive=${options.shouldMarkInactive === true}, scrapeSucceeded=${state.scrapeSucceeded}, softFailure=${hadSoftFailure}, scopedYards=${state.scrapedYardIds.length}, upserts=${state.upsertCount}`
    );
  } catch (error) {
    console.error(
      'Error during inactive reconciliation:',
      summarizeError(error)
    );
  }
}

function logScrapeDuration(startedAt, now = Date.now) {
  const duration = now() - startedAt;
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  console.log(`Scraping Duration: ${minutes} minutes and ${seconds} seconds.`);
}

module.exports = {
  createScrapeRun,
  logScrapeDuration,
  logScrapeRequest,
  reconcileScrapeRun,
};
