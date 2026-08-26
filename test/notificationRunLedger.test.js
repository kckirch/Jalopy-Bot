const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
const ledgerPath = path.join(repoRoot, 'src/database/notificationRunLedger.js');

function run(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (error) => error ? reject(error) : resolve());
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => error ? reject(error) : resolve());
  });
}

let tempDirectory;
let previousDbPath;
let db;
let ledger;

test.before(async () => {
  previousDbPath = process.env.VEHICLE_DB_PATH;
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-notification-ledger-'));
  process.env.VEHICLE_DB_PATH = path.join(tempDirectory, 'inventory.db');
  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[ledgerPath];
  const database = require(databasePath);
  db = database.db;
  await database.setupDatabase();
  ledger = require(ledgerPath);
});

test.beforeEach(() => run(db, 'DELETE FROM scheduled_job_runs;'));

test.after(async () => {
  await close(db);
  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[ledgerPath];
  if (previousDbPath === undefined) delete process.env.VEHICLE_DB_PATH;
  else process.env.VEHICLE_DB_PATH = previousDbPath;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('a notification run is claimed and completed exactly once', async () => {
  assert.equal(await ledger.claimNotificationRun('20260810'), true);
  await ledger.finishNotificationRun('20260810', 'completed', {
    newVehicleCount: 12,
  });

  const row = await ledger.getNotificationRun('20260810');
  assert.equal(row.status, 'completed');
  assert.deepEqual(row.summary, { newVehicleCount: 12 });
  assert.equal(await ledger.claimNotificationRun('20260810'), false);
});

test('failed and stale notification runs can be reclaimed', async () => {
  await ledger.claimNotificationRun('20260810');
  assert.equal(await ledger.claimNotificationRun('20260810'), false);
  await ledger.failNotificationRun('20260810');
  assert.equal(await ledger.claimNotificationRun('20260810'), true);

  await run(
    db,
    "UPDATE scheduled_job_runs SET started_at = datetime('now', '-31 minutes');"
  );
  assert.equal(await ledger.claimNotificationRun('20260810'), true);
});

test('notification session IDs and terminal states are validated', async () => {
  await assert.rejects(ledger.claimNotificationRun('not-a-date'), /invalid/);
  await ledger.claimNotificationRun('20260810');
  await assert.rejects(
    ledger.finishNotificationRun('20260810', 'unknown', {}),
    /terminal status is invalid/
  );
});
