const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const COVERAGE_MINIMUMS = {
  lines: 82,
  branches: 68,
  functions: 90,
};

function supportsCoverageThresholds(version = process.versions.node) {
  const [major, minor] = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10));

  return major > 22 || (major === 22 && minor >= 8);
}

function buildNodeArgs(argv, version = process.versions.node) {
  const coverageRequested = argv.includes('--coverage');
  const forwardedArgs = argv.filter((argument) => argument !== '--coverage');
  const nodeArgs = ['--test', '--test-concurrency=1'];

  if (coverageRequested) {
    if (!supportsCoverageThresholds(version)) {
      throw new Error('Coverage thresholds require Node.js 22.8.0 or newer.');
    }

    nodeArgs.push(
      '--experimental-test-coverage',
      `--test-coverage-lines=${COVERAGE_MINIMUMS.lines}`,
      `--test-coverage-branches=${COVERAGE_MINIMUMS.branches}`,
      `--test-coverage-functions=${COVERAGE_MINIMUMS.functions}`
    );
  }

  return [...nodeArgs, ...forwardedArgs];
}

function runTests(argv = process.argv.slice(2)) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-bot-tests-'));
  const databasePath = path.join(tempDirectory, 'vehicleInventory.db');

  try {
    const result = spawnSync(process.execPath, buildNodeArgs(argv), {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        VEHICLE_DB_PATH: databasePath,
        TOKEN: 'test-token',
        CLIENT_ID: 'test-client-id',
        GUILD_ID: 'test-guild-id',
        INVENTORY_API_KEY: 'test-inventory-api-key',
      },
      stdio: 'inherit',
    });

    if (result.error) {
      throw result.error;
    }

    return Number.isInteger(result.status) ? result.status : 1;
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (require.main === module) {
  try {
    process.exitCode = runTests();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  COVERAGE_MINIMUMS,
  buildNodeArgs,
  runTests,
  supportsCoverageThresholds,
};
