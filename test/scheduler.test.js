const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const universalPath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');
const sessionCheckPath = path.join(repoRoot, 'src/notifications/sessionCheck.js');
const jobManagerPath = path.join(repoRoot, 'src/database/scheduledJobManager.js');
const scrapeLockPath = path.join(repoRoot, 'src/scraping/scrapeLock.js');
const cronPath = require.resolve('node-cron', { paths: [repoRoot] });

function replaceModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

async function withSchedulerMocks(mocks, runTest) {
  const modulePaths = [
    schedulerPath,
    cronPath,
    universalPath,
    dailyTasksPath,
    sessionCheckPath,
    jobManagerPath,
  ];
  const previous = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]])
  );

  replaceModule(cronPath, { schedule: mocks.schedule });
  replaceModule(universalPath, { universalWebScrape: mocks.universalWebScrape });
  replaceModule(dailyTasksPath, {
    processDailySavedSearches: mocks.processDailySavedSearches,
  });
  replaceModule(sessionCheckPath, { checkSessionUpdates: mocks.checkSessionUpdates });
  replaceModule(jobManagerPath, {
    claimScheduledJobRun: mocks.claimScheduledJobRun,
    failScheduledJobRun: mocks.failScheduledJobRun,
    finishScheduledJobRun: mocks.finishScheduledJobRun,
    getScheduledJobRun: mocks.getScheduledJobRun,
    isTerminalScheduledJobStatus: mocks.isTerminalScheduledJobStatus,
  });
  delete require.cache[schedulerPath];

  const scrapeLock = require(scrapeLockPath).__testables;
  scrapeLock.resetScrapeLockForTests();
  try {
    await runTest(require(schedulerPath));
  } finally {
    scrapeLock.resetScrapeLockForTests();
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  }
}

function buildBaseMocks(overrides = {}) {
  const runs = new Map();
  const key = (jobName, sessionID) => `${jobName}:${sessionID}`;
  return {
    runs,
    schedule: () => ({}),
    universalWebScrape: async () => {},
    processDailySavedSearches: async () => ({ savedSearchFailures: 0 }),
    checkSessionUpdates: async () => true,
    getScheduledJobRun: async (jobName, sessionID) =>
      runs.get(key(jobName, sessionID)) || null,
    claimScheduledJobRun: async (jobName, sessionID) => {
      const runKey = key(jobName, sessionID);
      const existing = runs.get(runKey);
      if (existing && ['running', 'completed', 'completed_with_errors'].includes(existing.status)) {
        return false;
      }
      runs.set(runKey, { status: 'running', summary: null });
      return true;
    },
    finishScheduledJobRun: async (jobName, sessionID, status, summary) => {
      runs.set(key(jobName, sessionID), { status, summary });
    },
    failScheduledJobRun: async (jobName, sessionID) => {
      runs.set(key(jobName, sessionID), { status: 'failed', summary: null });
    },
    isTerminalScheduledJobStatus: (status) =>
      status === 'completed' || status === 'completed_with_errors',
    ...overrides,
  };
}

const BEFORE_DUE = new Date('2026-01-01T10:00:00.000Z');
const AFTER_NOTIFICATION_DUE = new Date('2026-01-01T13:00:00.000Z');

test('startScheduledTasks atomically registers scrape, notification, and recovery jobs', async () => {
  const schedules = [];
  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    await startScheduledTasks({ now: () => BEFORE_DUE });
  });

  assert.deepEqual(schedules.map((item) => item.expression), [
    '0 5 * * *',
    '45 5 * * *',
    '30 * * * *',
  ]);
  assert.ok(schedules.every((item) =>
    item.options.timezone === 'Etc/GMT+7' && item.options.noOverlap === true
  ));
});

test('registration failure disposes partial tasks and permits a clean retry', async () => {
  let scheduleCalls = 0;
  let destroyed = 0;
  const mocks = buildBaseMocks({
    schedule: () => {
      scheduleCalls += 1;
      if (scheduleCalls === 2) throw new Error('registration failed');
      return { destroy: () => { destroyed += 1; } };
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    await assert.rejects(
      startScheduledTasks({ now: () => BEFORE_DUE }),
      /registration failed/
    );
    await startScheduledTasks({ now: () => BEFORE_DUE });
  });

  assert.equal(destroyed, 1);
  assert.equal(scheduleCalls, 5);
});

test('startScheduledTasks remains idempotent after successful registration', async () => {
  let scheduleCalls = 0;
  const mocks = buildBaseMocks({
    schedule: () => {
      scheduleCalls += 1;
      return {};
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    await startScheduledTasks({ now: () => BEFORE_DUE });
    assert.deepEqual(await startScheduledTasks({ now: () => BEFORE_DUE }), {
      started: false,
    });
  });
  assert.equal(scheduleCalls, 3);
});

test('scheduler context uses the configured timezone for session boundaries', async () => {
  const mocks = buildBaseMocks();
  await withSchedulerMocks(mocks, async ({ __testables }) => {
    assert.deepEqual(
      __testables.getSchedulerContext(
        new Date('2026-08-11T05:30:00.000Z'),
        'America/Denver'
      ),
      { sessionID: '20260810', minuteOfDay: 23 * 60 + 30 }
    );
  });
});

test('scrapeAllJunkyards runs every configured source and reports aggregate failure', async () => {
  const scrapeCalls = [];
  const mocks = buildBaseMocks({
    universalWebScrape: async (options) => {
      scrapeCalls.push(options);
      if (options.hasMultipleLocations === false) throw new Error('source failed');
    },
  });

  await withSchedulerMocks(mocks, async ({ scrapeAllJunkyards }) => {
    await assert.rejects(
      scrapeAllJunkyards('20260101'),
      /Scrape failed for 1 configured junkyard/
    );
  });
  assert.equal(scrapeCalls.length, 2);
  assert.ok(scrapeCalls.every((call) => call.sessionID === '20260101'));
});

test('ensureCurrentInventorySession scrapes only when readiness is incomplete', async () => {
  let readinessChecks = 0;
  let scrapeCalls = 0;
  const mocks = buildBaseMocks({
    checkSessionUpdates: async () => {
      readinessChecks += 1;
      return readinessChecks > 1;
    },
    universalWebScrape: async () => { scrapeCalls += 1; },
  });

  await withSchedulerMocks(mocks, async ({ ensureCurrentInventorySession }) => {
    assert.deepEqual(
      await ensureCurrentInventorySession('20260101', {
        retries: 0,
        retryDelayMs: 0,
      }),
      { sessionID: '20260101', scraped: true }
    );
  });
  assert.equal(scrapeCalls, 2);
  assert.equal(readinessChecks, 2);
});

test('recovery waits for each due time and catches up notifications after 05:45', async () => {
  let readinessChecks = 0;
  let notificationCalls = 0;
  const mocks = buildBaseMocks({
    checkSessionUpdates: async () => { readinessChecks += 1; return true; },
    processDailySavedSearches: async () => {
      notificationCalls += 1;
      return { savedSearchFailures: 0, newVehicleCount: 3 };
    },
  });

  await withSchedulerMocks(mocks, async ({ recoverDueScheduledJobs }) => {
    assert.equal((await recoverDueScheduledJobs({
      now: new Date('2026-01-01T11:59:00.000Z'),
      timezone: 'Etc/GMT+7',
    })).status, 'not-due');
    assert.equal((await recoverDueScheduledJobs({
      now: new Date('2026-01-01T12:30:00.000Z'),
      timezone: 'Etc/GMT+7',
    })).status, 'inventory-ready');
    assert.equal((await recoverDueScheduledJobs({
      now: AFTER_NOTIFICATION_DUE,
      timezone: 'Etc/GMT+7',
    })).status, 'completed');
  });
  assert.equal(readinessChecks, 2);
  assert.equal(notificationCalls, 1);
});

test('completed notification ledger prevents duplicate channel and DM runs', async () => {
  let notificationCalls = 0;
  const mocks = buildBaseMocks({
    processDailySavedSearches: async () => {
      notificationCalls += 1;
      return { savedSearchFailures: 0 };
    },
  });

  await withSchedulerMocks(mocks, async ({ runDailyNotificationJob }) => {
    assert.equal((await runDailyNotificationJob('20260101')).status, 'completed');
    assert.equal(
      (await runDailyNotificationJob('20260101')).status,
      'already-completed'
    );
  });
  assert.equal(notificationCalls, 1);
});

test('notification failure is recorded and retried on the next recovery', async () => {
  let calls = 0;
  const mocks = buildBaseMocks({
    processDailySavedSearches: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Discord unavailable');
      return { savedSearchFailures: 0 };
    },
  });

  await withSchedulerMocks(mocks, async ({ runDailyNotificationJob }) => {
    await assert.rejects(
      runDailyNotificationJob('20260101'),
      /Discord unavailable/
    );
    assert.equal(mocks.runs.get('daily-notifications:20260101').status, 'failed');
    assert.equal((await runDailyNotificationJob('20260101')).status, 'completed');
  });
  assert.equal(calls, 2);
});

test('saved-search delivery failures are recorded as a completed warning state', async () => {
  const mocks = buildBaseMocks({
    processDailySavedSearches: async () => ({ savedSearchFailures: 2 }),
  });

  await withSchedulerMocks(mocks, async ({ runDailyNotificationJob }) => {
    assert.equal(
      (await runDailyNotificationJob('20260101')).status,
      'completed_with_errors'
    );
  });
  assert.equal(
    mocks.runs.get('daily-notifications:20260101').status,
    'completed_with_errors'
  );
});

test('startup and hourly recovery execute missed notifications without duplicating them', async () => {
  const schedules = [];
  let notificationCalls = 0;
  const mocks = buildBaseMocks({
    schedule: (expression, callback) => {
      schedules.push({ expression, callback });
      return {};
    },
    processDailySavedSearches: async () => {
      notificationCalls += 1;
      return { savedSearchFailures: 0 };
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    await startScheduledTasks({ now: () => AFTER_NOTIFICATION_DUE });
    await schedules.find((item) => item.expression === '30 * * * *').callback();
  });
  assert.equal(notificationCalls, 1);
});
