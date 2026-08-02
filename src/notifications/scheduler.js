const cron = require('node-cron');
const { universalWebScrape } = require('../scraping/universalWebScrape');
const { processDailySavedSearches } = require('../notifications/dailyTasks');
const { getSessionID } = require('../bot/utils/utils');
const { checkSessionUpdates } = require('../notifications/sessionCheck');
const junkyards = require('../config/junkyards');
const { withScrapeLock } = require('../scraping/scrapeLock');
const { summarizeError } = require('../utils/errorSummary');

const DEFAULT_SCHEDULER_TIMEZONE = 'Etc/GMT+7'; // Mountain Standard Time (MST, UTC-7), no DST shift.

let scheduledTasksStarted = false;

function resolveSchedulerTimezone(env = process.env) {
  const configured = String(env.SCHEDULER_TIMEZONE || '').trim();
  return configured || DEFAULT_SCHEDULER_TIMEZONE;
}

// Helper function for retries
function retryOperation(operation, retries, delay) {
  return new Promise((resolve, reject) => {
    operation()
      .then(resolve)
      .catch((error) => {
        if (retries > 0) {
          console.log(`Retrying after ${summarizeError(error)}. ${retries} retries left.`);
          setTimeout(() => {
            retryOperation(operation, retries - 1, delay).then(resolve).catch(reject);
          }, delay);
        } else {
          const message = error && error.message ? error.message : String(error);
          reject(new Error('Max retries reached. ' + message));
        }
      });
  });
}

async function scrapeAllJunkyards(sessionID) {
  return withScrapeLock(`scheduled:${sessionID}`, async () => {
    const junkyardKeys = Object.keys(junkyards);
    const failures = [];
    for (const junkyardKey of junkyardKeys) {
      const junkyardConfig = junkyards[junkyardKey];
      const options = {
        ...junkyardConfig,
        make: 'ANY',
        model: 'ANY',
        sessionID: sessionID,
        shouldMarkInactive: true,
      };

      try {
        console.log(`Starting scraping for ${junkyardKey}`);
        await universalWebScrape(options);
        console.log(`Scraping completed for ${junkyardKey}`);
      } catch (error) {
        console.error(`Error scraping ${junkyardKey}:`, summarizeError(error));
        failures.push({ junkyardKey, error });
      }
    }

    if (failures.length > 0) {
      const details = failures
        .map(({ junkyardKey, error }) => {
          const message = error && error.message ? error.message : String(error);
          return `${junkyardKey}: ${message}`;
        })
        .join('; ');
      throw new Error(`Scrape failed for ${failures.length} junkyard(s). ${details}`);
    }
  });
}

async function runMissedMorningJobs({
  sessionID = getSessionID(),
  retries = 3,
  retryDelayMs = 5000,
} = {}) {
  await retryOperation(() => scrapeAllJunkyards(sessionID), retries, retryDelayMs);
  await processDailySavedSearches();
}

function startScheduledTasks() {
  if (scheduledTasksStarted) {
    console.log('Scheduled tasks already started. Skipping duplicate initialization.');
    return;
  }

  scheduledTasksStarted = true;
  const schedulerTimezone = resolveSchedulerTimezone();
  const scheduleOptions = { timezone: schedulerTimezone, noOverlap: true };
  console.log(`Scheduler timezone: ${schedulerTimezone}. Daily scrape at 05:00 and notifications at 05:45.`);

  // Scheduled scraping every day at 05:00 MST by default.
  cron.schedule('0 5 * * *', async () => {
    console.log('Scheduled scraping started.');
    const sessionID = getSessionID();
    console.log(`Session ID: ${sessionID}`);

    try {
      await retryOperation(() => {
        console.log('Attempting to scrape all junkyards...');
        return scrapeAllJunkyards(sessionID);
      }, 3, 5000);
      console.log('Scraping completed successfully.');
    } catch (error) {
      console.error('Scraping failed after retries:', summarizeError(error));
    }
  }, scheduleOptions);

  // Scheduled processing of saved searches every day at 05:45 MST by default.
  cron.schedule('45 5 * * *', async () => {
    console.log('Checking sessions and processing saved searches.');
    try {
      const sessionUpdated = await checkSessionUpdates();
      if (sessionUpdated) {
        await processDailySavedSearches();
        console.log('Daily saved searches processed successfully.');
      } else {
        console.log('Session not updated recently; skipping processing of saved searches.');
      }
    } catch (error) {
      console.error('Error during processing daily saved searches:', summarizeError(error));
    }
  }, scheduleOptions);
}

module.exports = {
  startScheduledTasks,
  scrapeAllJunkyards,
  runMissedMorningJobs,
  __testables: {
    resolveSchedulerTimezone,
    DEFAULT_SCHEDULER_TIMEZONE,
  },
};
