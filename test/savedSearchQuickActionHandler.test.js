const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQuickActionCustomId,
  QUICK_ACTION_PREFIX,
} = require('../src/bot/utils/interactionParameters');
const {
  handleSavedSearchQuickActionButton,
} = require('../src/bot/handlers/savedSearchQuickActionHandler');

function buildQuickHash(action, payload) {
  return buildQuickActionCustomId(action, payload).slice(
    QUICK_ACTION_PREFIX.length
  );
}

function makeInteraction(userId = 'user-1') {
  return {
    user: { id: userId },
    replies: [],
    updates: [],
    async reply(payload) {
      this.replies.push(payload);
    },
    async update(payload) {
      this.updates.push(payload);
    },
  };
}

async function withHandlerMocks(mocks, runTest) {
  const dependencies = {
    queryVehicles: mocks.queryVehicles || (async () => []),
    deleteSavedSearch: mocks.deleteSavedSearch || (async () => {}),
    getSavedSearches: mocks.getSavedSearches || (async () => []),
  };
  await runTest({
    handleSavedSearchQuickActionButton: (interaction, quickHash) =>
      handleSavedSearchQuickActionButton(
        interaction,
        quickHash,
        dependencies
      ),
  });
}

const basePayload = {
  uid: 'user-1',
  lc: 'boise',
  yd: '1020',
  mk: 'TOYOTA',
  md: 'CAMRY',
  yr: '2005',
  st: 'ACTIVE',
  sid: '',
  idx: 0,
};

test('expired and cross-user quick actions are rejected', async () => {
  await withHandlerMocks({}, async ({ handleSavedSearchQuickActionButton }) => {
    const expiredInteraction = makeInteraction();
    await handleSavedSearchQuickActionButton(expiredInteraction, 'missing-hash');
    assert.match(expiredInteraction.replies[0].content, /expired/i);

    const crossUserInteraction = makeInteraction('user-2');
    await handleSavedSearchQuickActionButton(
      crossUserInteraction,
      buildQuickHash('close', basePayload)
    );
    assert.match(crossUserInteraction.replies[0].content, /permission/i);
  });
});

test('close removes the saved-search action interface', async () => {
  await withHandlerMocks({}, async ({ handleSavedSearchQuickActionButton }) => {
    const interaction = makeInteraction();
    await handleSavedSearchQuickActionButton(
      interaction,
      buildQuickHash('close', basePayload)
    );

    assert.deepEqual(interaction.updates, [
      {
        content: 'Saved search actions closed.',
        embeds: [],
        components: [],
      },
    ]);
  });
});

test('run queries the saved criteria and renders current matches', async () => {
  const queryCalls = [];
  await withHandlerMocks(
    {
      queryVehicles: async (...args) => {
        queryCalls.push(args);
        return [
          {
            vehicle_year: 2005,
            vehicle_make: 'TOYOTA',
            vehicle_model: 'CAMRY',
            yard_name: 'BOISE',
            row_number: 7,
          },
        ];
      },
    },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('run', basePayload)
      );

      assert.deepEqual(queryCalls, [
        ['1020', 'TOYOTA', 'CAMRY', '2005', 'ACTIVE'],
      ]);
      assert.match(interaction.updates[0].embeds[0].data.title, /run this search/i);
      assert.equal(interaction.updates[0].components[0].components.length, 5);
    }
  );
});

test('delete reports when the final saved search is removed', async () => {
  const savedSearch = {
    id: 123,
    yard_id: '1020',
    make: 'TOYOTA',
    model: 'CAMRY',
    year_range: '2005',
    status: 'ACTIVE',
  };
  const deletedSearchIds = [];
  let reads = 0;

  await withHandlerMocks(
    {
      getSavedSearches: async () => {
        reads += 1;
        return reads === 1 ? [savedSearch] : [];
      },
      deleteSavedSearch: async (id) => deletedSearchIds.push(id),
    },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('delete', {
          ...basePayload,
          sid: savedSearch.id,
        })
      );

      assert.deepEqual(deletedSearchIds, ['123']);
      assert.equal(reads, 2);
      assert.match(interaction.updates[0].content, /Deleted 1 saved search/);
      assert.match(interaction.updates[0].content, /no saved searches left/i);
    }
  );
});

test('view clears stale actions when the user has no saved searches', async () => {
  await withHandlerMocks(
    { getSavedSearches: async () => [] },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('view', basePayload)
      );

      assert.deepEqual(interaction.updates, [
        {
          content: 'You have no saved searches.',
          embeds: [],
          components: [],
        },
      ]);
    }
  );
});

test('legacy delete removes every matching search and renders the remaining item', async () => {
  const matchingSearches = [
    {
      id: 11,
      yard_id: '1020',
      make: 'TOYOTA',
      model: 'CAMRY',
      year_range: '2005',
      status: 'ACTIVE',
    },
    {
      id: 12,
      yard_id: '1020',
      make: 'TOYOTA',
      model: 'CAMRY',
      year_range: '2005',
      status: 'ACTIVE',
    },
  ];
  const remainingSearch = {
    id: 13,
    yard_id: '1021',
    make: 'HONDA',
    model: 'ACCORD',
    year_range: '2010',
    status: 'INACTIVE',
  };
  const deletedSearchIds = [];
  let reads = 0;

  await withHandlerMocks(
    {
      getSavedSearches: async () => {
        reads += 1;
        return reads === 1 ? [...matchingSearches, remainingSearch] : [remainingSearch];
      },
      deleteSavedSearch: async (id) => deletedSearchIds.push(id),
    },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('delete', {
          ...basePayload,
          sid: '',
          idx: 8,
        })
      );

      assert.deepEqual(deletedSearchIds, [11, 12]);
      assert.equal(reads, 2);
      assert.equal(interaction.updates.length, 1);
      assert.match(interaction.updates[0].embeds[0].data.title, /deleted/i);
      assert.match(interaction.updates[0].embeds[0].data.description, /Deleted 2 saved searches/);
      assert.equal(
        interaction.updates[0].embeds[0].data.fields.find(
          (field) => field.name === 'Make'
        ).value,
        'HONDA'
      );
      assert.equal(interaction.updates[0].components[0].components.length, 5);
    }
  );
});

test('next cycles through saved searches in the action interface', async () => {
  const savedSearches = [
    {
      id: 1,
      yard_id: '1020',
      make: 'TOYOTA',
      model: 'CAMRY',
      year_range: '2005',
      status: 'ACTIVE',
    },
    {
      id: 2,
      yard_id: '1021',
      make: 'HONDA',
      model: 'ACCORD',
      year_range: '2010',
      status: 'ACTIVE',
    },
  ];

  await withHandlerMocks(
    { getSavedSearches: async () => savedSearches },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('next', basePayload)
      );

      const fields = interaction.updates[0].embeds[0].data.fields;
      assert.equal(fields.find((field) => field.name === 'Make').value, 'HONDA');
      assert.equal(
        fields.find((field) => field.name === 'Saved Searches').value,
        '2 (showing 2 of 2)'
      );
    }
  );
});

test('view clamps an out-of-range position to the final saved search', async () => {
  const savedSearches = [
    {
      id: 1,
      yard_id: '1020',
      make: 'TOYOTA',
      model: 'CAMRY',
      year_range: '2005',
      status: 'ACTIVE',
    },
    {
      id: 2,
      yard_id: '1021',
      make: 'HONDA',
      model: 'ACCORD',
      year_range: '2010',
      status: 'ACTIVE',
    },
  ];

  await withHandlerMocks(
    { getSavedSearches: async () => savedSearches },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('view', { ...basePayload, idx: 99 })
      );

      const fields = interaction.updates[0].embeds[0].data.fields;
      assert.equal(fields.find((field) => field.name === 'Make').value, 'HONDA');
      assert.equal(
        fields.find((field) => field.name === 'Saved Searches').value,
        '2 (showing 2 of 2)'
      );
    }
  );
});

test('unsupported quick actions receive a bounded ephemeral reply', async () => {
  let savedSearchReads = 0;
  await withHandlerMocks(
    {
      getSavedSearches: async () => {
        savedSearchReads += 1;
        return [];
      },
    },
    async ({ handleSavedSearchQuickActionButton }) => {
      const interaction = makeInteraction();
      await handleSavedSearchQuickActionButton(
        interaction,
        buildQuickHash('unsupported', basePayload)
      );

      assert.deepEqual(interaction.replies, [
        {
          content: 'Unsupported quick action.',
          ephemeral: true,
        },
      ]);
      assert.equal(interaction.updates.length, 0);
      assert.equal(savedSearchReads, 0);
    }
  );
});
