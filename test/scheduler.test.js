const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const universalWebScrapePath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');
const utilsPath = path.join(repoRoot, 'src/bot/utils/utils.js');
const sessionCheckPath = path.join(repoRoot, 'src/notifications/sessionCheck.js');
const pushPath = path.join(repoRoot, 'src/notifications/pushToScrapedData.js');
const scrapeLockPath = path.join(repoRoot, 'src/scraping/scrapeLock.js');
const cronPath = require.resolve('node-cron', { paths: [repoRoot] });

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function withSchedulerMocks(mocks, runTest) {
  const previousScheduler = require.cache[schedulerPath];
  const previousCron = require.cache[cronPath];
  const previousUniversal = require.cache[universalWebScrapePath];
  const previousDailyTasks = require.cache[dailyTasksPath];
  const previousUtils = require.cache[utilsPath];
  const previousSessionCheck = require.cache[sessionCheckPath];
  const previousPush = require.cache[pushPath];

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
  require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: { getSessionID: mocks.getSessionID },
  };
  require.cache[sessionCheckPath] = {
    id: sessionCheckPath,
    filename: sessionCheckPath,
    loaded: true,
    exports: { checkSessionUpdates: mocks.checkSessionUpdates },
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: { pushToScrapedData: mocks.pushToScrapedData },
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

    if (previousUtils) require.cache[utilsPath] = previousUtils;
    else delete require.cache[utilsPath];

    if (previousSessionCheck) require.cache[sessionCheckPath] = previousSessionCheck;
    else delete require.cache[sessionCheckPath];

    if (previousPush) require.cache[pushPath] = previousPush;
    else delete require.cache[pushPath];
  }
}

function buildBaseMocks(overrides = {}) {
  return {
    schedule: () => ({}),
    universalWebScrape: async () => {},
    processDailySavedSearches: async () => {},
    getSessionID: () => '20260101',
    checkSessionUpdates: async () => true,
    pushToScrapedData: async () => {},
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
  assert.deepEqual(schedules[0].options, { scheduled: true, timezone: 'Etc/GMT+7' });
  assert.deepEqual(schedules[1].options, { scheduled: true, timezone: 'Etc/GMT+7' });
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

test('scrape cron callback performs scrape and then pushes scraped data', async () => {
  const schedules = [];
  const scrapeCalls = [];
  let pushCalls = 0;

  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
    universalWebScrape: async (options) => {
      scrapeCalls.push(options);
    },
    pushToScrapedData: async () => {
      pushCalls += 1;
    },
  });

  await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
    startScheduledTasks();
    await schedules[0].callback();
    await tick();
  });

  assert.equal(pushCalls, 1);
  assert.equal(scrapeCalls.length, 2);
});

test('scrape cron callback logs push failures without throwing', async () => {
  const schedules = [];
  let pushCalls = 0;
  const pushedErrorMessages = [];

  const originalConsoleError = console.error;
  console.error = (...args) => {
    pushedErrorMessages.push(args.map((value) => String(value)).join(' '));
  };

  const mocks = buildBaseMocks({
    schedule: (expression, callback, options) => {
      schedules.push({ expression, callback, options });
      return {};
    },
    pushToScrapedData: async () => {
      pushCalls += 1;
      throw new Error('simulated-push-failure');
    },
  });

  try {
    await withSchedulerMocks(mocks, async ({ startScheduledTasks }) => {
      startScheduledTasks();
      await schedules[0].callback();
      await tick();
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(pushCalls, 1);
  assert.ok(
    pushedErrorMessages.some((message) => message.includes('Failed to push scraped data:')),
    `Expected push failure log, got logs: ${pushedErrorMessages.join(' || ')}`
  );
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
