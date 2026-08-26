const cron = require('node-cron');
const junkyards = require('../config/junkyards');
const { checkSessionUpdates } = require('./sessionCheck');
const { processDailySavedSearches } = require('./dailyTasks');
const {
  claimScheduledJobRun,
  failScheduledJobRun,
  finishScheduledJobRun,
  getScheduledJobRun,
  isTerminalScheduledJobStatus,
} = require('../database/scheduledJobManager');
const { formatScrapeLogValue } = require('../scraping/scrapeLogging');
const { withScrapeLock } = require('../scraping/scrapeLock');
const { scrapeWithHttp } = require('../scraping/httpInventoryScrape');
const { summarizeError } = require('../utils/errorSummary');
const { getSchedulerContext } = require('./schedulerTime');

const DEFAULT_SCHEDULER_TIMEZONE = 'Etc/GMT+7';
const DAILY_NOTIFICATION_JOB = 'daily-notifications';
const SCRAPE_DUE_MINUTE = 5 * 60;
const NOTIFICATION_DUE_MINUTE = 5 * 60 + 45;

let scheduledTasksStarted = false;

function resolveSchedulerTimezone(env = process.env) {
  const configured = String(env.SCHEDULER_TIMEZONE || '').trim();
  return configured || DEFAULT_SCHEDULER_TIMEZONE;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function retryOperation(operation, retries, delayMs) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        console.log(
          `Retrying failed operation. ${retries - attempt} retries left.`
        );
        await wait(delayMs);
      }
    }
  }
  throw new Error('Max retries reached for scheduled operation.', {
    cause: lastError,
  });
}

async function scrapeAllJunkyards(sessionID) {
  return withScrapeLock(`scheduled:${sessionID}`, async () => {
    const failures = [];
    for (const [junkyardKey, junkyardConfig] of Object.entries(junkyards)) {
      const options = {
        ...junkyardConfig,
        make: 'ANY',
        model: 'ANY',
        sessionID,
        shouldMarkInactive: true,
      };
      try {
        console.log(
          `Starting configured scrape: ${formatScrapeLogValue(junkyardKey)}`
        );
        await scrapeWithHttp(options);
        console.log(
          `Completed configured scrape: ${formatScrapeLogValue(junkyardKey)}`
        );
      } catch (error) {
        console.error(
          `Configured scrape failed: ${formatScrapeLogValue(junkyardKey)}`,
          summarizeError(error)
        );
        failures.push(error);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Scrape failed for ${failures.length} configured junkyard(s).`
      );
    }
  });
}

async function ensureCurrentInventorySession(
  sessionID,
  { retries = 3, retryDelayMs = 5000 } = {}
) {
  if (await checkSessionUpdates({ sessionID })) {
    return { sessionID, scraped: false };
  }

  await retryOperation(
    () => scrapeAllJunkyards(sessionID),
    retries,
    retryDelayMs
  );
  if (!(await checkSessionUpdates({ sessionID }))) {
    throw new Error('Inventory session remains incomplete after scraping.');
  }
  return { sessionID, scraped: true };
}

async function markJobFailedPreservingError(sessionID, originalError) {
  try {
    await failScheduledJobRun(DAILY_NOTIFICATION_JOB, sessionID);
  } catch (ledgerError) {
    console.error(
      'Failed to record scheduled notification failure:',
      summarizeError(ledgerError)
    );
  }
  throw originalError;
}

async function runDailyNotificationJob(sessionID) {
  const existing = await getScheduledJobRun(
    DAILY_NOTIFICATION_JOB,
    sessionID
  );
  if (isTerminalScheduledJobStatus(existing?.status)) {
    return { status: 'already-completed', summary: existing.summary };
  }

  const claimed = await claimScheduledJobRun(
    DAILY_NOTIFICATION_JOB,
    sessionID
  );
  if (!claimed) return { status: 'already-running', summary: null };

  try {
    const summary = await processDailySavedSearches({ sessionID });
    const status = summary.savedSearchFailures > 0
      ? 'completed_with_errors'
      : 'completed';
    await finishScheduledJobRun(
      DAILY_NOTIFICATION_JOB,
      sessionID,
      status,
      summary
    );
    return { status, summary };
  } catch (error) {
    return markJobFailedPreservingError(sessionID, error);
  }
}

async function recoverDueScheduledJobs({
  now = new Date(),
  timezone = resolveSchedulerTimezone(),
  retries = 3,
  retryDelayMs = 5000,
} = {}) {
  const context = getSchedulerContext(now, timezone);
  if (context.minuteOfDay < SCRAPE_DUE_MINUTE) {
    return { status: 'not-due', sessionID: context.sessionID };
  }

  await ensureCurrentInventorySession(context.sessionID, {
    retries,
    retryDelayMs,
  });
  if (context.minuteOfDay < NOTIFICATION_DUE_MINUTE) {
    return { status: 'inventory-ready', sessionID: context.sessionID };
  }
  return runDailyNotificationJob(context.sessionID);
}

async function runMissedMorningJobs({
  sessionID = getSchedulerContext(new Date(), resolveSchedulerTimezone()).sessionID,
  retries = 3,
  retryDelayMs = 5000,
} = {}) {
  await ensureCurrentInventorySession(sessionID, { retries, retryDelayMs });
  return runDailyNotificationJob(sessionID);
}

async function runCronOperation(label, operation) {
  try {
    const result = await operation();
    console.log(`${label} completed with status ${result.status || 'ready'}.`);
    return result;
  } catch (error) {
    console.error(`${label} failed:`, summarizeError(error));
    return null;
  }
}

function disposeScheduledTasks(tasks) {
  for (const task of tasks) {
    if (typeof task.destroy === 'function') task.destroy();
    else if (typeof task.stop === 'function') task.stop();
  }
}

function registerScheduledTasks(timezone, now) {
  const options = { timezone, noOverlap: true };
  const tasks = [];
  try {
    tasks.push(cron.schedule('0 5 * * *', () => {
      const context = getSchedulerContext(now(), timezone);
      return runCronOperation('Scheduled inventory scrape', () =>
        ensureCurrentInventorySession(context.sessionID)
      );
    }, options));
    tasks.push(cron.schedule('45 5 * * *', () =>
      runCronOperation('Scheduled daily notifications', () =>
        recoverDueScheduledJobs({ now: now(), timezone })
      ), options));
    tasks.push(cron.schedule('30 * * * *', () =>
      runCronOperation('Scheduled recovery check', () =>
        recoverDueScheduledJobs({ now: now(), timezone })
      ), options));
    return tasks;
  } catch (error) {
    disposeScheduledTasks(tasks);
    throw error;
  }
}

async function startScheduledTasks({ now = () => new Date() } = {}) {
  if (scheduledTasksStarted) {
    console.log('Scheduled tasks already started. Skipping duplicate initialization.');
    return { started: false };
  }

  const timezone = resolveSchedulerTimezone();
  registerScheduledTasks(timezone, now);
  scheduledTasksStarted = true;
  console.log(
    `Scheduler timezone: ${formatScrapeLogValue(timezone)}. Daily scrape at 05:00, notifications at 05:45, hourly recovery at :30.`
  );
  await runCronOperation('Startup scheduled-job recovery', () =>
    recoverDueScheduledJobs({ now: now(), timezone })
  );
  return { started: true };
}

module.exports = {
  ensureCurrentInventorySession,
  recoverDueScheduledJobs,
  runDailyNotificationJob,
  runMissedMorningJobs,
  scrapeAllJunkyards,
  startScheduledTasks,
  __testables: {
    DAILY_NOTIFICATION_JOB,
    DEFAULT_SCHEDULER_TIMEZONE,
    getSchedulerContext,
    resolveSchedulerTimezone,
  },
};
