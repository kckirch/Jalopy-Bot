const test = require('node:test');
const assert = require('node:assert/strict');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const {
  COVERAGE_MINIMUMS,
  buildNodeArgs,
  runTestCli,
  supportsCoverageThresholds,
} = require('../scripts/run-tests');

test('test runner supports coverage thresholds on Node 22.8 and newer', () => {
  assert.equal(supportsCoverageThresholds('22.7.0'), false);
  assert.equal(supportsCoverageThresholds('22.8.0'), true);
  assert.equal(supportsCoverageThresholds('24.0.0'), true);
});

test('test runner forwards file filters while isolating test execution', () => {
  assert.deepEqual(buildNodeArgs(['test/sessionId.test.js'], '20.10.0'), [
    '--test',
    '--test-concurrency=1',
    'test/sessionId.test.js',
  ]);
});

test('coverage mode applies the repository minimums', () => {
  assert.deepEqual(buildNodeArgs(['--coverage'], '24.0.0'), [
    '--test',
    '--test-concurrency=1',
    '--experimental-test-coverage',
    '--test-coverage-exclude=test/**',
    '--test-coverage-exclude=test-support/**',
    `--test-coverage-lines=${COVERAGE_MINIMUMS.lines}`,
    `--test-coverage-branches=${COVERAGE_MINIMUMS.branches}`,
    `--test-coverage-functions=${COVERAGE_MINIMUMS.functions}`,
  ]);
});

test('coverage mode rejects runtimes that cannot enforce thresholds', () => {
  assert.throws(
    () => buildNodeArgs(['--coverage'], '20.20.2'),
    /Node\.js 22\.8\.0 or newer/
  );
});

test('test runner CLI redacts failures and sets a failing exit code', async () => {
  const privateErrorDetails = 'private spawn path /home/kc/private-node';
  const previousExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    const consoleCalls = await captureConsole(async () => {
      runTestCli(() => {
        throw new TypeError(privateErrorDetails);
      });
    });

    assert.equal(process.exitCode, 1);
    assert.match(joinedConsoleText(consoleCalls), /Test runner failed: TypeError/);
    assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});
