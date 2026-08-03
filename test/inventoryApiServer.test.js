const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sqlite3 = require('sqlite3').verbose();
const {
  runInventoryApiCli,
  startInventoryApiServer,
} = require('../src/api/inventoryApiServer');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

function createEmptyDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      database.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
  });
}

test('inventory API server refuses to start without an API key', async () => {
  await assert.rejects(
    () => startInventoryApiServer({ apiKey: '' }),
    /INVENTORY_API_KEY is required/
  );
  await assert.rejects(
    () => startInventoryApiServer({ apiKey: '   ' }),
    /INVENTORY_API_KEY is required/
  );
});

test('inventory API CLI redacts startup failures and exits nonzero', async () => {
  const previousExitCode = process.exitCode;
  const privateDetails = 'private API key and database path';
  process.exitCode = 0;

  try {
    const consoleCalls = await captureConsole(() =>
      runInventoryApiCli(async () => {
        throw new URIError(privateDetails);
      })
    );
    const consoleText = joinedConsoleText(consoleCalls);

    assert.equal(process.exitCode, 1);
    assert.match(consoleText, /\[inventory-api\] failed to start: URIError/);
    assert.equal(consoleText.includes(privateDetails), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('inventory API process exits before listening when its database cannot be opened', () => {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'jalopy-api-startup-failure-')
  );
  const blockingFile = path.join(tempDirectory, 'not-a-directory');
  const databasePath = path.join(blockingFile, 'vehicleInventory.db');
  fs.writeFileSync(blockingFile, 'blocks database access');

  try {
    const result = spawnSync(process.execPath, ['src/api/inventoryApiServer.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        VEHICLE_DB_PATH: databasePath,
        INVENTORY_API_KEY: 'private-test-api-key',
        INVENTORY_API_HOST: '127.0.0.1',
        INVENTORY_API_PORT: '18787',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(
      output,
      /\[inventory-api\] failed to start: Error \[SQLITE_CANTOPEN\]/
    );
    assert.equal(output.includes('[inventory-api] listening on'), false);
    assert.equal(output.includes(databasePath), false);
    assert.equal(output.includes('private-test-api-key'), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('inventory API process exits before listening when its public snapshot cannot prewarm', async () => {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'jalopy-api-readiness-failure-')
  );
  const databasePath = path.join(tempDirectory, 'vehicleInventory.db');
  await createEmptyDatabase(databasePath);

  try {
    const result = spawnSync(process.execPath, ['src/api/inventoryApiServer.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        VEHICLE_DB_PATH: databasePath,
        INVENTORY_API_KEY: 'private-test-api-key',
        INVENTORY_API_HOST: '127.0.0.1',
        INVENTORY_API_PORT: '18788',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1);
    assert.match(
      output,
      /\[inventory-api\] failed to prewarm public vehicle snapshot: Error/
    );
    assert.match(output, /\[inventory-api\] failed to start: Error/);
    assert.equal(output.includes('[inventory-api] listening on'), false);
    assert.equal(output.includes(databasePath), false);
    assert.equal(output.includes('private-test-api-key'), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
