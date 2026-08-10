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
  await run.upsertVehicle(1020, 'vehicle');
  run.markSucceeded();

  assert.equal(run.startedAt, 1000);
  assert.deepEqual(upserts, [[1020, 'vehicle']]);
  assert.deepEqual(run.getState(), {
    scrapeSucceeded: true,
    scrapedYardIds: [1020],
    upsertCount: 1,
    upsertCountsByYard: { 1020: 1 },
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
  await run.upsertVehicle(1020, 'vehicle');
  run.markSucceeded();

  await reconcileScrapeRun(
    run,
    { sessionID: '20260101', shouldMarkInactive: true },
    async (...args) => calls.push(args)
  );

  assert.deepEqual(calls, [['20260101', { yardIds: [1020] }]]);
});

test('soft failures reject before unsafe reconciliation', async () => {
  const run = createScrapeRun(async () => {});
  run.trackYard('1020');
  await run.upsertVehicle(1020, 'vehicle');
  run.markSucceeded();

  const consoleCalls = await captureConsole(() =>
    assert.rejects(
      reconcileScrapeRun(
        run,
        { sessionID: '20260101', shouldMarkInactive: true },
        async () => assert.fail('reconciliation should be skipped'),
        { hadSoftFailure: true }
      ),
      /complete yard coverage/
    )
  );

  assert.match(
    joinedConsoleText(consoleCalls),
    /Error during inactive reconciliation: Error/
  );
});

test('reconciliation failures and lifecycle logs are bounded', async () => {
  const privateDetails = '/home/private/database.db user-value';
  const run = createScrapeRun(async () => {}, { now: () => 0 });
  run.trackYard('1020');
  await run.upsertVehicle(1020, 'vehicle');
  run.markSucceeded();

  const consoleCalls = await captureConsole(async () => {
    logScrapeRequest({ yardId: 1020, make: 'TOYOTA', model: 'CAMRY' });
    await assert.rejects(
      reconcileScrapeRun(
        run,
        { sessionID: '20260101', shouldMarkInactive: true },
        async () => {
          throw new TypeError(privateDetails);
        }
      ),
      (error) => error.message === privateDetails
    );
    logScrapeDuration(run.startedAt, () => 65000);
  });
  const output = joinedConsoleText(consoleCalls);

  assert.match(output, /\[scrape\] Start yard=1020 scope=filtered/);
  assert.match(output, /Error during inactive reconciliation: TypeError/);
  assert.match(output, /Scraping Duration: 1 minutes and 5 seconds\./);
  assert.equal(output.includes(privateDetails), false);
});

test('a multi-yard run rejects when any scoped yard produced zero rows', async () => {
  const run = createScrapeRun(async () => {});
  run.trackYard(1020);
  run.trackYard(1021);
  await run.upsertVehicle(1020, 'vehicle');
  run.markSucceeded();

  await assert.rejects(
    reconcileScrapeRun(
      run,
      { sessionID: '20260101', shouldMarkInactive: true },
      async () => assert.fail('reconciliation must remain blocked')
    ),
    /complete yard coverage/
  );
});
