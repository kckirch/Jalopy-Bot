const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createScrapeRun,
  logScrapeDuration,
  logScrapeRequest,
  reconcileScrapeRun,
} = require('../src/scraping/scrapeLifecycle');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

test('scrape run tracks successful upserts and valid unique yard IDs', async () => {
  const upserts = [];
  const run = createScrapeRun(async (...args) => upserts.push(args), {
    now: () => 1000,
  });

  run.trackYard('1020');
  run.trackYard(1020);
  run.trackYard('1020junk');
  await run.upsertVehicle('vehicle');
  run.markSucceeded();

  assert.equal(run.startedAt, 1000);
  assert.deepEqual(upserts, [['vehicle']]);
  assert.deepEqual(run.getState(), {
    scrapeSucceeded: true,
    scrapedYardIds: [1020],
    upsertCount: 1,
  });
});

test('failed upserts do not increase the completed upsert count', async () => {
  const run = createScrapeRun(async () => {
    throw new Error('failed write');
  });

  await assert.rejects(run.upsertVehicle('vehicle'), /failed write/);
  assert.equal(run.getState().upsertCount, 0);
});

test('successful scrape run reconciles only its validated yard scope', async () => {
  const calls = [];
  const run = createScrapeRun(async () => {});
  run.trackYard('1020');
  await run.upsertVehicle('vehicle');
  run.markSucceeded();

  await reconcileScrapeRun(
    run,
    { sessionID: '20260101', shouldMarkInactive: true },
    async (...args) => calls.push(args)
  );

  assert.deepEqual(calls, [['20260101', { yardIds: [1020] }]]);
});

test('soft failures skip reconciliation and report shared run state', async () => {
  const run = createScrapeRun(async () => {});
  run.trackYard('1020');
  await run.upsertVehicle('vehicle');
  run.markSucceeded();

  const consoleCalls = await captureConsole(() =>
    reconcileScrapeRun(
      run,
      { sessionID: '20260101', shouldMarkInactive: true },
      async () => assert.fail('reconciliation should be skipped'),
      { hadSoftFailure: true }
    )
  );

  assert.match(joinedConsoleText(consoleCalls), /softFailure=true/);
  assert.match(joinedConsoleText(consoleCalls), /scopedYards=1, upserts=1/);
});

test('reconciliation failures and lifecycle logs are bounded', async () => {
  const privateDetails = '/home/private/database.db user-value';
  const run = createScrapeRun(async () => {}, { now: () => 0 });
  run.trackYard('1020');
  await run.upsertVehicle('vehicle');
  run.markSucceeded();

  const consoleCalls = await captureConsole(async () => {
    logScrapeRequest({ yardId: 1020, make: 'TOYOTA', model: 'CAMRY' });
    await reconcileScrapeRun(
      run,
      { sessionID: '20260101', shouldMarkInactive: true },
      async () => {
        throw new TypeError(privateDetails);
      }
    );
    logScrapeDuration(run.startedAt, () => 65000);
  });
  const output = joinedConsoleText(consoleCalls);

  assert.match(output, /Yard ID: 1020/);
  assert.match(output, /Error during inactive reconciliation: TypeError/);
  assert.match(output, /Scraping Duration: 1 minutes and 5 seconds\./);
  assert.equal(output.includes(privateDetails), false);
});
