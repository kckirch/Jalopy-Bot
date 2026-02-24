const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'src/notifications/testScheduler.js');
const schedulerPath = path.join(repoRoot, 'src/notifications/scheduler.js');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');
const utilsPath = path.join(repoRoot, 'src/bot/utils/utils.js');

async function withTestSchedulerMocks(mocks, runTest) {
  const previousModule = require.cache[modulePath];
  const previousScheduler = require.cache[schedulerPath];
  const previousDailyTasks = require.cache[dailyTasksPath];
  const previousUtils = require.cache[utilsPath];

  require.cache[schedulerPath] = {
    id: schedulerPath,
    filename: schedulerPath,
    loaded: true,
    exports: { scrapeAllJunkyards: mocks.scrapeAllJunkyards },
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
  delete require.cache[modulePath];

  try {
    const moduleExports = require(modulePath);
    await runTest(moduleExports);
  } finally {
    if (previousModule) require.cache[modulePath] = previousModule;
    else delete require.cache[modulePath];

    if (previousScheduler) require.cache[schedulerPath] = previousScheduler;
    else delete require.cache[schedulerPath];

    if (previousDailyTasks) require.cache[dailyTasksPath] = previousDailyTasks;
    else delete require.cache[dailyTasksPath];

    if (previousUtils) require.cache[utilsPath] = previousUtils;
    else delete require.cache[utilsPath];
  }
}

test('testScheduler module import has no side effects and exports callable functions', async () => {
  let scrapeCalls = 0;
  let processCalls = 0;

  await withTestSchedulerMocks(
    {
      scrapeAllJunkyards: async () => { scrapeCalls += 1; },
      processDailySavedSearches: async () => { processCalls += 1; },
      getSessionID: () => '20260101',
    },
    async ({ performScrape, processSearches }) => {
      assert.equal(typeof performScrape, 'function');
      assert.equal(typeof processSearches, 'function');

      // Import alone should not trigger execution.
      assert.equal(scrapeCalls, 0);
      assert.equal(processCalls, 0);

      await performScrape();
      await processSearches();

      assert.equal(scrapeCalls, 1);
      assert.equal(processCalls, 1);
    }
  );
});
