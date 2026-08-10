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

test('checkSessionUpdates accepts a completed current inventory session', async () => {
  let capturedSql;
  let capturedParams;
  const mockDb = {
    get(sql, params, callback) {
      capturedSql = sql;
      capturedParams = params;
      callback(null, { coveredYardCount: 3 });
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates({
      sessionID: '20260810',
      expectedYardIds: [1020, 1021, 1119],
    });

    assert.equal(result, true);
    assert.match(capturedSql, /session_id = \?/);
    assert.match(capturedSql, /COUNT\(DISTINCT yard_id\)/);
    assert.deepEqual(capturedParams, ['20260810', 1020, 1021, 1119]);
  });
});

test('checkSessionUpdates does not expire a completed session based on its age', async () => {
  const mockDb = {
    get(_sql, _params, callback) {
      callback(null, { coveredYardCount: 2 });
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates({
      sessionID: '20260810',
      expectedYardIds: [1020, 1021],
    });

    assert.equal(result, true);
  });
});

test('checkSessionUpdates rejects a partial current inventory session', async () => {
  const mockDb = {
    get(_sql, _params, callback) {
      callback(null, { coveredYardCount: 2 });
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates({
      sessionID: '20260810',
      expectedYardIds: [1020, 1021, 1119],
    });

    assert.equal(result, false);
  });
});

test('checkSessionUpdates returns false when no current session rows exist', async () => {
  const mockDb = {
    get(_sql, _params, callback) {
      callback(null, { coveredYardCount: 0 });
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates({
      sessionID: '20260810',
      expectedYardIds: [1020],
    });

    assert.equal(result, false);
  });
});

test('checkSessionUpdates returns false without configured yard coverage', async () => {
  let queried = false;
  const mockDb = {
    get() {
      queried = true;
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    const result = await checkSessionUpdates({
      sessionID: '20260810',
      expectedYardIds: [],
    });

    assert.equal(result, false);
    assert.equal(queried, false);
  });
});

test('checkSessionUpdates rejects when db.get errors', async () => {
  const mockDb = {
    get(_sql, _params, callback) {
      callback(new Error('db-failure'));
    },
  };

  await withSessionCheck(mockDb, async (checkSessionUpdates) => {
    await assert.rejects(
      checkSessionUpdates({
        sessionID: '20260810',
        expectedYardIds: [1020],
      }),
      /db-failure/
    );
  });
});
