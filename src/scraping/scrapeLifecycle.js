const { summarizeError } = require('../utils/errorSummary');
const { normalizeYardId } = require('./yardIdNormalization');
const { logScrapeRequest } = require('./scrapeLogging');

function createScrapeRun(upsertVehicle, { now = Date.now } = {}) {
  const startedAt = now();
  const scrapedYardIds = new Set();
  const upsertCountsByYard = new Map();
  let scrapeSucceeded = false;
  let upsertCount = 0;

  return {
    startedAt,
    async upsertVehicle(...args) {
      await upsertVehicle(...args);
      upsertCount += 1;
      const normalizedYardId = normalizeYardId(args[0]);
      if (normalizedYardId !== null) {
        const yardCount = upsertCountsByYard.get(normalizedYardId) || 0;
        upsertCountsByYard.set(normalizedYardId, yardCount + 1);
      }
    },
    trackYard(yardId) {
      const normalizedYardId = normalizeYardId(yardId);
      if (normalizedYardId !== null) {
        scrapedYardIds.add(normalizedYardId);
        if (!upsertCountsByYard.has(normalizedYardId)) {
          upsertCountsByYard.set(normalizedYardId, 0);
        }
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
        upsertCountsByYard: Object.fromEntries(upsertCountsByYard),
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

  if (options.shouldMarkInactive !== true || !state.scrapeSucceeded) {
    console.log(
      `Skipping inactive reconciliation. shouldMarkInactive=${options.shouldMarkInactive === true}, scrapeSucceeded=${state.scrapeSucceeded}, softFailure=${hadSoftFailure}, scopedYards=${state.scrapedYardIds.length}, upserts=${state.upsertCount}`
    );
    return;
  }

  try {
    const incompleteYardCount = state.scrapedYardIds.filter(
      (yardId) => !state.upsertCountsByYard[yardId]
    ).length;
    if (
      hadSoftFailure ||
      state.scrapedYardIds.length === 0 ||
      incompleteYardCount > 0
    ) {
      throw new Error(
        'Inactive reconciliation blocked because the scrape did not produce complete yard coverage.'
      );
    }

    await reconcileInactiveVehicles(options.sessionID, {
      yardIds: state.scrapedYardIds,
    });
  } catch (error) {
    console.error(
      'Error during inactive reconciliation:',
      summarizeError(error)
    );
    throw error;
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
