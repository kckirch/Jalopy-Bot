const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pushModulePath = path.join(repoRoot, 'src/notifications/pushToScrapedData.js');
const dbPathModulePath = path.join(repoRoot, 'src/database/dbPath.js');
const simpleGitPath = require.resolve('simple-git', { paths: [repoRoot] });

async function withPushToScrapedDataMocks({ gitMock, dbPath }, runTest) {
  const previousPushModule = require.cache[pushModulePath];
  const previousDbPathModule = require.cache[dbPathModulePath];
  const previousSimpleGitModule = require.cache[simpleGitPath];

  require.cache[dbPathModulePath] = {
    id: dbPathModulePath,
    filename: dbPathModulePath,
    loaded: true,
    exports: { VEHICLE_DB_PATH: dbPath },
  };

  require.cache[simpleGitPath] = {
    id: simpleGitPath,
    filename: simpleGitPath,
    loaded: true,
    exports: () => gitMock,
  };

  delete require.cache[pushModulePath];

  try {
    const { pushToScrapedData } = require(pushModulePath);
    await runTest(pushToScrapedData);
  } finally {
    if (previousPushModule) require.cache[pushModulePath] = previousPushModule;
    else delete require.cache[pushModulePath];

    if (previousDbPathModule) require.cache[dbPathModulePath] = previousDbPathModule;
    else delete require.cache[dbPathModulePath];

    if (previousSimpleGitModule) require.cache[simpleGitPath] = previousSimpleGitModule;
    else delete require.cache[simpleGitPath];
  }
}

function createGitMock(overrides = {}) {
  const calls = [];
  const mock = {
    calls,
    async status() {
      calls.push(['status']);
      return { files: [] };
    },
    async branchLocal() {
      calls.push(['branchLocal']);
      return { all: ['main', 'scraped-data'], current: 'main' };
    },
    async checkout(...args) {
      calls.push(['checkout', ...args]);
    },
    async checkoutLocalBranch(...args) {
      calls.push(['checkoutLocalBranch', ...args]);
    },
    async pull(...args) {
      calls.push(['pull', ...args]);
    },
    async add(...args) {
      calls.push(['add', ...args]);
    },
    async diff(...args) {
      calls.push(['diff', ...args]);
      return 'src/bot/vehicleInventory.db\n';
    },
    async commit(...args) {
      calls.push(['commit', ...args]);
    },
    async push(...args) {
      calls.push(['push', ...args]);
    },
    ...overrides,
  };
  return mock;
}

test('pushToScrapedData skips when working tree has non-DB changes', async () => {
  const gitMock = createGitMock({
    async status() {
      this.calls.push(['status']);
      return { files: [{ path: 'README.md' }] };
    },
  });

  await withPushToScrapedDataMocks(
    {
      gitMock,
      dbPath: path.join(repoRoot, 'src/bot/vehicleInventory.db'),
    },
    async (pushToScrapedData) => {
      const result = await pushToScrapedData();
      assert.deepEqual(result, { pushed: false, reason: 'conflicting_worktree_changes' });
    }
  );

  assert.deepEqual(gitMock.calls, [['status']]);
});

test('pushToScrapedData skips commit/push when DB has no staged changes', async () => {
  const gitMock = createGitMock({
    async diff(...args) {
      this.calls.push(['diff', ...args]);
      return '';
    },
  });

  await withPushToScrapedDataMocks(
    {
      gitMock,
      dbPath: path.join(repoRoot, 'src/bot/vehicleInventory.db'),
    },
    async (pushToScrapedData) => {
      const result = await pushToScrapedData();
      assert.deepEqual(result, { pushed: false, reason: 'no_db_changes' });
    }
  );

  const commitCalls = gitMock.calls.filter((entry) => entry[0] === 'commit');
  const pushCalls = gitMock.calls.filter((entry) => entry[0] === 'push');
  assert.equal(commitCalls.length, 0);
  assert.equal(pushCalls.length, 0);
  assert.ok(gitMock.calls.some((entry) => entry[0] === 'checkout' && entry[1] === 'main'));
});

test('pushToScrapedData commits and pushes DB changes without force checkout or empty commits', async () => {
  const gitMock = createGitMock();

  await withPushToScrapedDataMocks(
    {
      gitMock,
      dbPath: path.join(repoRoot, 'src/bot/vehicleInventory.db'),
    },
    async (pushToScrapedData) => {
      const result = await pushToScrapedData();
      assert.deepEqual(result, { pushed: true });
    }
  );

  const checkoutCalls = gitMock.calls.filter((entry) => entry[0] === 'checkout');
  assert.ok(checkoutCalls.some((entry) => entry[1] === 'scraped-data' && entry.length === 2));

  const commitCalls = gitMock.calls.filter((entry) => entry[0] === 'commit');
  assert.equal(commitCalls.length, 1);
  assert.deepEqual(commitCalls[0], ['commit', 'Auto-update scraped data']);

  const pushCalls = gitMock.calls.filter((entry) => entry[0] === 'push');
  assert.equal(pushCalls.length, 1);
  assert.deepEqual(pushCalls[0], ['push', 'origin', 'scraped-data']);
});
