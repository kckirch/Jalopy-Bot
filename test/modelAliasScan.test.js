const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'src/testing/modelAliasScan.js');
const vehicleQueryManagerPath = path.join(
  repoRoot,
  'src/database/vehicleQueryManager.js'
);

delete require.cache[modulePath];
delete require.cache[vehicleQueryManagerPath];
const {
  parseArgs,
  runModelAliasScan,
  runModelAliasScanCli,
} = require(modulePath);

test('importing modelAliasScan does not open the vehicle database', () => {
  assert.equal(require.cache[vehicleQueryManagerPath], undefined);
});

test('model alias scan parses filters and reports normalized variant groups', async () => {
  const databaseCalls = [];
  const database = {
    all(sql, params, callback) {
      databaseCalls.push({ sql, params });
      callback(null, [
        { make: 'TOYOTA', model: 'RAV-4', count: 3 },
        { make: 'TOYOTA', model: 'RAV4', count: 2 },
        { make: 'TOYOTA', model: 'CAMRY', count: 5 },
      ]);
    },
  };
  const logCalls = [];
  const logger = {
    log(message) {
      logCalls.push(message);
    },
  };

  assert.deepEqual(parseArgs(['--limit', '5', '--make', 'toyota', '--active-only']), {
    limit: 5,
    make: 'TOYOTA',
    activeOnly: true,
  });

  const groups = await runModelAliasScan({
    argv: ['--limit', '5', '--make', 'toyota', '--active-only'],
    database,
    logger,
  });

  assert.equal(databaseCalls.length, 1);
  assert.match(databaseCalls[0].sql, /vehicle_status != 'INACTIVE'/);
  assert.match(databaseCalls[0].sql, /UPPER\(vehicle_make\) = \?/);
  assert.deepEqual(databaseCalls[0].params, ['TOYOTA']);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'RAV4');
  assert.equal(groups[0].totalCount, 5);
  assert.ok(logCalls.some((message) => /variant groups found: 1/.test(message)));
  assert.ok(logCalls.some((message) => /RAV-4 \(3\) \| RAV4 \(2\)/.test(message)));
});

test('model alias CLI redacts scan and close failures', async () => {
  const scanDetails = 'private alias /home/kc/private-inventory.db';
  const closeDetails = 'private close path /home/kc/private-inventory.db';
  const errorCalls = [];
  const previousExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    await runModelAliasScanCli({
      databaseFactory: () => ({}),
      runScan: async () => {
        throw new TypeError(scanDetails);
      },
      close: async () => {
        throw new RangeError(closeDetails);
      },
      logger: {
        error(...args) {
          errorCalls.push(args.join(' '));
        },
      },
    });

    const errorText = errorCalls.join('\n');
    assert.equal(process.exitCode, 1);
    assert.match(errorText, /\[alias-scan\] failed: TypeError/);
    assert.match(errorText, /failed to close database: RangeError/);
    assert.equal(errorText.includes(scanDetails), false);
    assert.equal(errorText.includes(closeDetails), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});
