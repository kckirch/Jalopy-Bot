const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sessionCheckPath = path.join(repoRoot, 'src/notifications/sessionCheck.js');
const databasePath = path.join(repoRoot, 'src/database/database.js');

async function withSessionCheck(mockDb, runTest) {
  const previousSessionCheck = require.cache[sessionCheckPath];
  const previousDatabase = require.cache[databasePath];

  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: { db: mockDb },
  };
  delete require.cache[sessionCheckPath];

  try {
    const { checkSessionUpdates } = require(sessionCheckPath);
    await runTest(checkSessionUpdates);
  } finally {
    if (previousSessionCheck) require.cache[sessionCheckPath] = previousSessionCheck;
    else delete require.cache[sessionCheckPath];

    if (previousDatabase) require.cache[databasePath] = previousDatabase;
    else delete require.cache[databasePath];
  }
}

test('checkSessionUpdates returns true when last update is recent', async () => {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const mockDb = {
    get(_sql, callback) {
      callback(null, { lastUpdate: tenMinutesAgo });
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates();
    assert.equal(result, true);
  });
});

test('checkSessionUpdates returns false when last update is stale', async () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const mockDb = {
    get(_sql, callback) {
      callback(null, { lastUpdate: twoHoursAgo });
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates();
    assert.equal(result, false);
  });
});

test('checkSessionUpdates rejects when db.get errors', async () => {
  const mockDb = {
    get(_sql, callback) {
      callback(new Error('db-failure'));
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    await assert.rejects(checkSessionUpdates(), /db-failure/);
  });
});
