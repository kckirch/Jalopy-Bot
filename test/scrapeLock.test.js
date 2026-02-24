const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'src/scraping/scrapeLock.js');
const {
  withScrapeLock,
  isScrapeRunning,
  getActiveScrapeLabel,
  __testables,
} = require(modulePath);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('withScrapeLock blocks overlapping scrapes and exposes active label', async () => {
  __testables.resetScrapeLockForTests();
  const deferred = createDeferred();

  const firstRun = withScrapeLock('scheduled:20260101', async () => {
    await deferred.promise;
  });

  assert.equal(isScrapeRunning(), true);
  assert.equal(getActiveScrapeLabel(), 'scheduled:20260101');

  await assert.rejects(
    () => withScrapeLock('manual:user-1', async () => {}),
    (error) => error && error.code === 'SCRAPE_IN_PROGRESS'
  );

  deferred.resolve();
  await firstRun;

  assert.equal(isScrapeRunning(), false);
  assert.equal(getActiveScrapeLabel(), null);
});

test('withScrapeLock releases lock after failures', async () => {
  __testables.resetScrapeLockForTests();

  await assert.rejects(
    () => withScrapeLock('scheduled:fail', async () => {
      throw new Error('forced-failure');
    }),
    /forced-failure/
  );

  assert.equal(isScrapeRunning(), false);

  let secondRunExecuted = false;
  await withScrapeLock('manual:retry', async () => {
    secondRunExecuted = true;
  });

  assert.equal(secondRunExecuted, true);
});

