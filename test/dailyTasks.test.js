const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const dailyTasksPath = path.join(repoRoot, 'src/notifications/dailyTasks.js');
const clientPath = path.join(repoRoot, 'src/bot/utils/client.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');
const vehicleQueryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function withDailyTasksMocks(mocks, runTest) {
  const previousNewVehiclesChannelId = process.env.NEW_VEHICLES_CHANNEL_ID;
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

  process.env.NEW_VEHICLES_CHANNEL_ID = Object.hasOwn(mocks, 'newVehiclesChannelId')
    ? mocks.newVehiclesChannelId
    : '111111111111111111';

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

    if (previousNewVehiclesChannelId === undefined) delete process.env.NEW_VEHICLES_CHANNEL_ID;
    else process.env.NEW_VEHICLES_CHANNEL_ID = previousNewVehiclesChannelId;
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
        notes: 'Needs tires',
      },
    ];
  };

  const consoleCalls = await captureConsole(async () => {
    await withDailyTasksMocks(
      { client, getAllSavedSearches, queryVehicles },
      async ({ processDailySavedSearches }) => {
        await processDailySavedSearches();
        await tick();
        await tick();
      }
    );
  });

  assert.ok(queryCalls.some((call) => call.status === 'ACTIVE'));
  assert.ok(queryCalls.some((call) => call.status === 'NEW'));
  assert.equal(dmSends.length, 1);
  assert.equal(channelSends.length, 1);
  assert.ok(Array.isArray(dmSends[0].payload.embeds));
  assert.ok(Array.isArray(channelSends[0].payload.embeds));
  assert.equal(channelSends[0].id, '111111111111111111');

  const dmEmbed = dmSends[0].payload.embeds[0].toJSON();
  const channelEmbed = channelSends[0].payload.embeds[0].toJSON();
  assert.equal(
    dmEmbed.title,
    'Daily Search Results for TOYOTA CAMRY (ANY) at BOISE with ACTIVE status'
  );
  assert.equal(dmEmbed.description, 'Results found: 1');
  assert.equal(dmEmbed.fields[0].name, 'TOYOTA CAMRY (2004)');
  assert.match(dmEmbed.fields[0].value, /Yard: BOISE, Row: 77/);
  assert.match(dmEmbed.fields[0].value, /Notes: Needs tires/);
  assert.equal(channelEmbed.title, 'New Vehicles Added Today');
  assert.equal(channelEmbed.fields[0].name, 'TOYOTA CAMRY (2005)');

  const logOutput = joinedConsoleText(consoleCalls);
  for (const privateValue of ['user-1', 'user#1', '111111111111111111']) {
    assert.equal(logOutput.includes(privateValue), false, privateValue);
  }
});

test('notifyNewVehicles creates a new embed after every 25 vehicle fields', async () => {
  const channelSends = [];
  const timestamp = '2026-08-02T06:00:00.000Z';
  const vehicles = Array.from({ length: 26 }, (_value, index) => ({
    yard_name: 'BOISE',
    row_number: index + 1,
    vehicle_make: 'TEST',
    vehicle_model: `MODEL-${index + 1}`,
    vehicle_year: 2000 + index,
    first_seen: timestamp,
    last_updated: timestamp,
    notes: '',
  }));

  await withDailyTasksMocks(
    {
      client: {
        isReady: () => true,
        channels: {
          cache: {
            get: (id) => ({
              id,
              send: async (payload) => channelSends.push(payload),
            }),
          },
        },
      },
      getAllSavedSearches: async () => [],
      queryVehicles: async () => vehicles,
    },
    async ({ notifyNewVehicles }) => {
      await notifyNewVehicles();
    }
  );

  const embeds = channelSends.flatMap((payload) => payload.embeds);
  assert.equal(embeds.length, 2);
  assert.equal(embeds[0].toJSON().fields.length, 25);
  assert.equal(embeds[1].toJSON().fields.length, 1);
});

test('notifyNewVehicles skips delivery when its channel is not configured', async () => {
  let queryCalled = false;
  const consoleCalls = await captureConsole(async () => {
    await withDailyTasksMocks(
      {
        newVehiclesChannelId: '',
        client: { isReady: () => true },
        getAllSavedSearches: async () => [],
        queryVehicles: async () => {
          queryCalled = true;
          return [];
        },
      },
      async ({ notifyNewVehicles }) => {
        await notifyNewVehicles();
      }
    );
  });

  assert.equal(queryCalled, false);
  assert.match(joinedConsoleText(consoleCalls), /NEW_VEHICLES_CHANNEL_ID/);
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

test('processDailySavedSearches skips saved searches with paused frequency', async () => {
  const dmSends = [];
  const queryCalls = [];

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
        get: () => null,
      },
    },
  };

  await withDailyTasksMocks(
    {
      client,
      getAllSavedSearches: async () => [
        {
          user_id: 'user-paused',
          username: 'user#paused',
          yard_id: '1020',
          yard_name: 'BOISE',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: 'ANY',
          status: 'ACTIVE',
          frequency: 'paused',
        },
      ],
      queryVehicles: async (...args) => {
        queryCalls.push(args);
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
  // Only NEW-vehicle summary query should run when all saved searches are paused.
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0][4], 'NEW');
});

test('processDailySavedSearches does not log upstream error details', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-file';
  const consoleCalls = await captureConsole(async () => {
    await withDailyTasksMocks(
      {
        client: { isReady: () => true },
        getAllSavedSearches: async () => [{
          user_id: 'private-user',
          yard_id: '1020',
          make: 'PRIVATE-MAKE',
          model: 'PRIVATE-MODEL',
          year_range: 'ANY',
          status: 'ACTIVE',
        }],
        queryVehicles: async (_yardId, _make, _model, _yearRange, status) => {
          if (status === 'ACTIVE') {
            throw new TypeError(privateErrorDetails);
          }
          return [];
        },
      },
      async ({ processDailySavedSearches }) => {
        await processDailySavedSearches();
      }
    );
  });

  const logOutput = joinedConsoleText(consoleCalls);
  assert.match(logOutput, /Error processing saved search: TypeError/);
  assert.equal(logOutput.includes(privateErrorDetails), false);
  assert.equal(logOutput.includes('PRIVATE-MODEL'), false);
});
