const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const universalWebScrapePath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');
const sessionIdPath = path.join(repoRoot, 'src/utils/sessionId.js');
const sessionCheckPath = path.join(repoRoot, 'src/notifications/sessionCheck.js');
const scrapeLockPath = path.join(repoRoot, 'src/scraping/scrapeLock.js');
const cronPath = require.resolve('node-cron', { paths: [repoRoot] });

async function withSchedulerMocks(mocks, runTest) {
  const previousScheduler = require.cache[schedulerPath];
  const previousCron = require.cache[cronPath];
  const previousUniversal = require.cache[universalWebScrapePath];
  const previousDailyTasks = require.cache[dailyTasksPath];
  const previousSessionId = require.cache[sessionIdPath];
  const previousSessionCheck = require.cache[sessionCheckPath];

  require.cache[cronPath] = {
    id: cronPath,
    filename: cronPath,
    loaded: true,
    exports: { schedule: mocks.schedule },
  };
  require.cache[universalWebScrapePath] = {
    id: universalWebScrapePath,
    filename: universalWebScrapePath,
    loaded: true,
    exports: { universalWebScrape: mocks.universalWebScrape },
  };
  require.cache[dailyTasksPath] = {
    id: dailyTasksPath,
    filename: dailyTasksPath,
    loaded: true,
    exports: { processDailySavedSearches: mocks.processDailySavedSearches },
  };
  require.cache[sessionIdPath] = {
    id: sessionIdPath,
    filename: sessionIdPath,
    loaded: true,
    exports: { getSessionID: mocks.getSessionID },
  };
  require.cache[sessionCheckPath] = {
    id: sessionCheckPath,
    filename: sessionCheckPath,
    loaded: true,
    exports: { checkSessionUpdates: mocks.checkSessionUpdates },
  };
  delete require.cache[schedulerPath];

  const scrapeLockModule = require(scrapeLockPath);
  scrapeLockModule.__testables.resetScrapeLockForTests();

  try {
    const moduleExports = require(schedulerPath);
    await runTest(moduleExports);
  } finally {
    scrapeLockModule.__testables.resetScrapeLockForTests();

    if (previousScheduler) require.cache[schedulerPath] = previousScheduler;
    else delete require.cache[schedulerPath];

    if (previousCron) require.cache[cronPath] = previousCron;
    else delete require.cache[cronPath];

    if (previousUniversal) require.cache[universalWebScrapePath] = previousUniversal;
    else delete require.cache[universalWebScrapePath];

    if (previousDailyTasks) require.cache[dailyTasksPath] = previousDailyTasks;
    else delete require.cache[dailyTasksPath];

    if (previousSessionId) require.cache[sessionIdPath] = previousSessionId;
    else delete require.cache[sessionIdPath];

    if (previousSessionCheck) require.cache[sessionCheckPath] = previousSessionCheck;
    else delete require.cache[sessionCheckPath];
  }
}

function buildBaseMocks(overrides = {}) {
  return {
    schedule: () => ({}),
    universalWebScrape: async () => {},
    processDailySavedSearches: async () => {},
    getSessionID: () => '20260101',
    checkSessionUpdates: async () => true,
    ...overrides,
  };
}

test('startScheduledTasks registers the expected two cron schedules', async () => {
  const schedules = [];
  const previousTimezone = process.env.SCHEDULER_TIMEZONE;
  delete process.env.SCHEDULER_TIMEZONE;
  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
  });

  try {
    await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
      startScheduledTasks();
    });
  } finally {
    if (typeof previousTimezone === 'string') {
      process.env.SCHEDULER_TIMEZONE = previousTimezone;
    } else {
      delete process.env.SCHEDULER_TIMEZONE;
    }
  }

  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].expression, '0 5 * * *');
  assert.equal(schedules[1].expression, '45 5 * * *');
  assert.deepEqual(schedules[0].options, { timezone: 'Etc/GMT+7', noOverlap: true });
  assert.deepEqual(schedules[1].options, { timezone: 'Etc/GMT+7', noOverlap: true });
});

test('startScheduledTasks uses SCHEDULER_TIMEZONE override when provided', async () => {
  const schedules = [];
  const previousTimezone = process.env.SCHEDULER_TIMEZONE;
  process.env.SCHEDULER_TIMEZONE = 'America/Denver';
  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
  });

  try {
    await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
      startScheduledTasks();
    });
  } finally {
    if (typeof previousTimezone === 'string') {
      process.env.SCHEDULER_TIMEZONE = previousTimezone;
    } else {
      delete process.env.SCHEDULER_TIMEZONE;
    }
  }

  assert.equal(schedules.length, 2);
  assert.equal(schedules[0].options.timezone, 'America/Denver');
  assert.equal(schedules[1].options.timezone, 'America/Denver');
});

test('startScheduledTasks is idempotent and does not register duplicate cron jobs', async () => {
  const schedules = [];
  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    startScheduledTasks();
    startScheduledTasks();
  });

  assert.equal(schedules.length, 2);
});

test('scrapeAllJunkyards calls universalWebScrape for each configured junkyard', async () => {
  const scrapeCalls = [];
  const mocks = buildBaseMocks({
    universalWebScrape: async (options) => {
      scrapeCalls.push(options);
    },
  });

  await withSchedulerMocks(mocks, async ({ scrapeAllJunkyards }) => {
    await scrapeAllJunkyards('20260101');
  });

  assert.equal(scrapeCalls.length, 2);
  assert.ok(scrapeCalls.every((call) => call.sessionID === '20260101'));
  assert.ok(scrapeCalls.every((call) => call.make === 'ANY'));
  assert.ok(scrapeCalls.every((call) => call.model === 'ANY'));
});

test('scrapeAllJunkyards rejects when any junkyard scrape fails', async () => {
  const scrapeCalls = [];
  const mocks = buildBaseMocks({
    universalWebScrape: async (options) => {
      scrapeCalls.push(options);
      if (options.hasMultipleLocations === false) {
        throw new Error('simulated scrape failure');
      }
    },
  });

  await withSchedulerMocks(mocks, async ({ scrapeAllJunkyards }) => {
    await assert.rejects(
      () => scrapeAllJunkyards('20260101'),
      /Scrape failed for 1 junkyard/
    );
  });

  assert.equal(scrapeCalls.length, 2);
});

test('scrapeAllJunkyards rejects when another scrape lock is already held', async () => {
  const scrapeCalls = [];
  const mocks = buildBaseMocks({
    universalWebScrape: async (options) => {
      scrapeCalls.push(options);
    },
  });

  const { withScrapeLock, __testables } = require(scrapeLockPath);
  __testables.resetScrapeLockForTests();

  await withSchedulerMocks(mocks, async ({ scrapeAllJunkyards }) => {
    await withScrapeLock('manual:in-progress', async () => {
      await assert.rejects(
        () => scrapeAllJunkyards('20260101'),
        (error) => error && error.code === 'SCRAPE_IN_PROGRESS'
      );
    });
  });

  assert.equal(scrapeCalls.length, 0);
});

test('runMissedMorningJobs completes every scrape before sending notifications', async () => {
  const events = [];
  const mocks = buildBaseMocks({
    universalWebScrape: async (options) => {
      events.push(`scrape:${options.sessionID}`);
    },
    processDailySavedSearches: async () => {
      events.push('notifications');
    },
  });

  await withSchedulerMocks(mocks, async ({ runMissedMorningJobs }) => {
    await runMissedMorningJobs({
      sessionID: '20260101',
      retries: 0,
      retryDelayMs: 0,
    });
  });

  assert.deepEqual(events, [
    'scrape:20260101',
    'scrape:20260101',
    'notifications',
  ]);
});

test('runMissedMorningJobs retries a failed scrape before sending notifications', async () => {
  let scrapeCalls = 0;
  let shouldFail = true;
  let notificationCalls = 0;
  const mocks = buildBaseMocks({
    universalWebScrape: async (options) => {
      scrapeCalls += 1;
      if (options.hasMultipleLocations === false && shouldFail) {
        shouldFail = false;
        throw new Error('simulated transient failure');
      }
    },
    processDailySavedSearches: async () => {
      notificationCalls += 1;
    },
  });

  await withSchedulerMocks(mocks, async ({ runMissedMorningJobs }) => {
    await runMissedMorningJobs({
      sessionID: '20260101',
      retries: 1,
      retryDelayMs: 0,
    });
  });

  assert.equal(scrapeCalls, 4);
  assert.equal(notificationCalls, 1);
});

test('runMissedMorningJobs rejects and skips notifications after scrape failure', async () => {
  let notificationCalls = 0;
  const mocks = buildBaseMocks({
    universalWebScrape: async () => {
      throw new Error('simulated permanent failure');
    },
    processDailySavedSearches: async () => {
      notificationCalls += 1;
    },
  });

  await withSchedulerMocks(mocks, async ({ runMissedMorningJobs }) => {
    await assert.rejects(
      () => runMissedMorningJobs({
        sessionID: '20260101',
        retries: 0,
        retryDelayMs: 0,
      }),
      /Max retries reached/
    );
  });

  assert.equal(notificationCalls, 0);
});

test('scrape cron callback performs every configured scrape', async () => {
  const schedules = [];
  const scrapeCalls = [];

  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
    universalWebScrape: async (options) => {
      scrapeCalls.push(options);
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    startScheduledTasks();
    await schedules[0].callback();
  });

  assert.equal(scrapeCalls.length, 2);
});

test('saved-search cron callback runs processing only when session check passes', async () => {
  const schedules = [];
  let processCalls = 0;
  let sessionShouldPass = true;

  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
    checkSessionUpdates: async () => sessionShouldPass,
    processDailySavedSearches: async () => {
      processCalls += 1;
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    startScheduledTasks();

    await schedules[1].callback();
    assert.equal(processCalls, 1);

    sessionShouldPass = false;
    await schedules[1].callback();
    assert.equal(processCalls, 1);
  });
});
