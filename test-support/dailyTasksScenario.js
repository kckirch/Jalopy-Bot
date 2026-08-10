function createNotificationClient(dmSends, channelSends) {
  return {
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
          messages: { fetch: async () => [] },
          send: async (payload) => {
            channelSends.push({ id, payload });
          },
        }),
      },
    },
  };
}

function createNotificationQueries(queryCalls, now) {
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

  return { getAllSavedSearches, queryVehicles };
}

function createNotificationScenario() {
  const dmSends = [];
  const channelSends = [];
  const queryCalls = [];
  const now = new Date().toISOString();
  const client = createNotificationClient(dmSends, channelSends);
  const queries = createNotificationQueries(queryCalls, now);

  return { dmSends, channelSends, queryCalls, client, ...queries };
}

module.exports = { createNotificationScenario };
