const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');
const managerPath = path.join(repoRoot, 'src/database/scheduledJobManager.js');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
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
let manager;

test.before(async () => {
  previousDbPath = process.env.VEHICLE_DB_PATH;
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-job-manager-'));
  process.env.VEHICLE_DB_PATH = path.join(tempDirectory, 'inventory.db');
  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[managerPath];
  const database = require(databasePath);
  db = database.db;
  await database.setupDatabase();
  manager = require(managerPath);
});

test.beforeEach(async () => {
  await run(db, 'DELETE FROM scheduled_job_runs;');
});

test.after(async () => {
  await close(db);
  delete require.cache[dbPathModulePath];
  delete require.cache[databasePath];
  delete require.cache[managerPath];
  if (previousDbPath === undefined) delete process.env.VEHICLE_DB_PATH;
  else process.env.VEHICLE_DB_PATH = previousDbPath;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('a claimed job can be completed once with a structured summary', async () => {
  assert.equal(
    await manager.claimScheduledJobRun('daily-notifications', '20260810'),
    true
  );
  await manager.finishScheduledJobRun(
    'daily-notifications',
    '20260810',
    'completed',
    { newVehicleCount: 12 }
  );

  const row = await manager.getScheduledJobRun(
    'daily-notifications',
    '20260810'
  );
  assert.equal(row.status, 'completed');
  assert.deepEqual(row.summary, { newVehicleCount: 12 });
  assert.equal(
    await manager.claimScheduledJobRun('daily-notifications', '20260810'),
    false
  );
});

test('a failed job can be claimed again while a fresh running job cannot', async () => {
  await manager.claimScheduledJobRun('daily-notifications', '20260810');
  assert.equal(
    await manager.claimScheduledJobRun('daily-notifications', '20260810'),
    false
  );

  await manager.failScheduledJobRun('daily-notifications', '20260810');
  assert.equal(
    await manager.claimScheduledJobRun('daily-notifications', '20260810'),
    true
  );
});

test('a stale running job can be recovered after a process interruption', async () => {
  await manager.claimScheduledJobRun('daily-notifications', '20260810');
  await run(
    db,
    "UPDATE scheduled_job_runs SET started_at = datetime('now', '-31 minutes');"
  );

  assert.equal(
    await manager.claimScheduledJobRun('daily-notifications', '20260810'),
    true
  );
});

test('scheduled job keys and terminal states are validated', async () => {
  await assert.rejects(
    manager.claimScheduledJobRun('Daily Notifications', 'not-a-date'),
    /invalid/
  );
  await manager.claimScheduledJobRun('daily-notifications', '20260810');
  await assert.rejects(
    manager.finishScheduledJobRun(
      'daily-notifications',
      '20260810',
      'unknown',
      {}
    ),
    /terminal status is invalid/
  );
});
