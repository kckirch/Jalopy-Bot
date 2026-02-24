const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');
const clientPath = path.join(repoRoot, 'src/bot/utils/client.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');
const vehicleQueryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function withDailyTasksMocks(mocks, runTest) {
  const previousDailyTasks = require.cache[dailyTasksPath];
  const previousClient = require.cache[clientPath];
  const previousSavedSearchManager = require.cache[savedSearchManagerPath];
  const previousVehicleQueryManager = require.cache[vehicleQueryManagerPath];

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: { client: mocks.client },
  };
  require.cache[savedSearchManagerPath] = {
    id: savedSearchManagerPath,
    filename: savedSearchManagerPath,
    loaded: true,
    exports: { getAllSavedSearches: mocks.getAllSavedSearches },
  };
  require.cache[vehicleQueryManagerPath] = {
    id: vehicleQueryManagerPath,
    filename: vehicleQueryManagerPath,
    loaded: true,
    exports: { queryVehicles: mocks.queryVehicles },
  };
  delete require.cache[dailyTasksPath];

  try {
    const moduleExports = require(dailyTasksPath);
    await runTest(moduleExports);
  } finally {
    if (previousDailyTasks) require.cache[dailyTasksPath] = previousDailyTasks;
    else delete require.cache[dailyTasksPath];

    if (previousClient) require.cache[clientPath] = previousClient;
    else delete require.cache[clientPath];

    if (previousSavedSearchManager) require.cache[savedSearchManagerPath] = previousSavedSearchManager;
    else delete require.cache[savedSearchManagerPath];

    if (previousVehicleQueryManager) require.cache[vehicleQueryManagerPath] = previousVehicleQueryManager;
    else delete require.cache[vehicleQueryManagerPath];
  }
}

test('processDailySavedSearches sends matching user notifications and new-vehicle channel alert', async () => {
  const dmSends = [];
  const channelSends = [];
  const queryCalls = [];
  const now = new Date().toISOString();

  const client = {
    isReady: () => true,
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          dmSends.push({ id, payload });
        },
      }),
    },
    channels: {
      cache: {
        get: (id) => ({
          id,
          send: async (payload) => {
            channelSends.push({ id, payload });
          },
        }),
      },
    },
  };

  const getAllSavedSearches = async () => [
    {
      user_id: 'user-1',
      username: 'user#1',
      yard_id: '1020',
      yard_name: 'BOISE',
      make: 'TOYOTA',
      model: 'CAMRY',
      year_range: 'ANY',
      status: 'ACTIVE',
    },
  ];

  const queryVehicles = async (yardId, make, model, yearRange, status) => {
    queryCalls.push({ yardId, make, model, yearRange, status });
    if (status === 'NEW') {
      return [
        {
          yard_name: 'BOISE',
          row_number: 12,
          vehicle_make: 'TOYOTA',
          vehicle_model: 'CAMRY',
          vehicle_year: 2005,
          first_seen: now,
          last_updated: now,
          notes: '',
        },
      ];
    }
    return [
      {
        yard_name: 'BOISE',
        row_number: 77,
        vehicle_make: 'TOYOTA',
        vehicle_model: 'CAMRY',
        vehicle_year: 2004,
        first_seen: now,
        last_updated: now,
        notes: '',
      },
    ];
  };

  await withDailyTasksMocks(
    { client, getAllSavedSearches, queryVehicles },
    async ({ processDailySavedSearches }) => {
      await processDailySavedSearches();
      await tick();
      await tick();
    }
  );

  assert.ok(queryCalls.some((call) => call.status === 'ACTIVE'));
  assert.ok(queryCalls.some((call) => call.status === 'NEW'));
  assert.equal(dmSends.length, 1);
  assert.equal(channelSends.length, 1);
  assert.ok(Array.isArray(dmSends[0].payload.embeds));
  assert.ok(Array.isArray(channelSends[0].payload.embeds));
});

test('processDailySavedSearches awaits DM delivery before resolving', async () => {
  const dmSends = [];
  const now = new Date().toISOString();
  let resolveDmSend;
  let sendStarted = false;
  let completed = false;
  const dmGate = new Promise((resolve) => {
    resolveDmSend = resolve;
  });

  const client = {
    isReady: () => true,
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          sendStarted = true;
          await dmGate;
          dmSends.push({ id, payload });
        },
      }),
    },
    channels: {
      cache: {
        get: () => null,
      },
    },
  };

  await withDailyTasksMocks(
    {
      client,
      getAllSavedSearches: async () => [
        {
          user_id: 'user-await',
          username: 'user#await',
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: 'ANY',
          status: 'ACTIVE',
        },
      ],
      queryVehicles: async (_yardId, _make, _model, _yearRange, status) => {
        if (status === 'NEW') return [];
        return [
          {
            yard_name: 'BOISE',
            row_number: 77,
            vehicle_make: 'TOYOTA',
            vehicle_model: 'CAMRY',
            vehicle_year: 2004,
            first_seen: now,
            last_updated: now,
            notes: '',
          },
        ];
      },
    },
    async ({ processDailySavedSearches }) => {
      const run = processDailySavedSearches().then(() => {
        completed = true;
      });

      await tick();
      assert.equal(sendStarted, true);
      assert.equal(completed, false);

      resolveDmSend();
      await run;
    }
  );

  assert.equal(completed, true);
  assert.equal(dmSends.length, 1);
});

test('processDailySavedSearches does not send DMs when no active matches exist', async () => {
  const dmSends = [];
  const channelSends = [];

  const client = {
    isReady: () => true,
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          dmSends.push({ id, payload });
        },
      }),
    },
    channels: {
      cache: {
        get: (id) => ({
          id,
          send: async (payload) => {
            channelSends.push({ id, payload });
          },
        }),
      },
    },
  };

  await withDailyTasksMocks(
    {
      client,
      getAllSavedSearches: async () => [
        {
          user_id: 'user-2',
          username: 'user#2',
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'FORD',
          model: 'RANGER',
          year_range: 'ANY',
          status: 'ACTIVE',
        },
      ],
      queryVehicles: async (_yardId, _make, _model, _yearRange, status) => {
        if (status === 'NEW') return [];
        return [];
      },
    },
    async ({ processDailySavedSearches }) => {
      await processDailySavedSearches();
      await tick();
      await tick();
    }
  );

  assert.equal(dmSends.length, 0);
  assert.equal(channelSends.length, 0);
});

test('processDailySavedSearches is safe when Discord client is not ready', async () => {
  const dmSends = [];
  const channelSends = [];
  const now = new Date().toISOString();

  const client = {
    isReady: () => false,
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          dmSends.push({ id, payload });
        },
      }),
    },
    channels: {
      cache: {
        get: (id) => ({
          id,
          send: async (payload) => {
            channelSends.push({ id, payload });
          },
        }),
      },
    },
  };

  await withDailyTasksMocks(
    {
      client,
      getAllSavedSearches: async () => [
        {
          user_id: 'user-3',
          username: 'user#3',
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'COROLLA',
          year_range: 'ANY',
          status: 'ACTIVE',
        },
      ],
      queryVehicles: async (_yardId, _make, _model, _yearRange, _status) => [
        {
          yard_name: 'BOISE',
          row_number: 5,
          vehicle_make: 'TOYOTA',
          vehicle_model: 'COROLLA',
          vehicle_year: 2003,
          first_seen: now,
          last_updated: now,
          notes: '',
        },
      ],
    },
    async ({ processDailySavedSearches }) => {
      await processDailySavedSearches();
      await tick();
      await tick();
    }
  );

  assert.equal(dmSends.length, 0);
  assert.equal(channelSends.length, 0);
});
