const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleSearchAction,
} = require('../src/bot/handlers/searchInteractionActions');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

const criteria = Object.freeze({
  make: 'TOYOTA',
  model: 'CAMRY',
  yearRange: '2005',
  status: 'ACTIVE',
});

function makeSession() {
  return {
    criteria,
    searchState: {
      location: 'boise',
      yardId: 1020,
      vehicles: [],
      suggestedModels: [],
      currentPage: 0,
      totalPages: 0,
    },
  };
}

function makeInteraction(overrides = {}) {
  return {
    user: {
      id: 'user-1',
      tag: 'user-1#0001',
      async send() {},
    },
    replies: [],
    updates: [],
    async reply(payload) {
      this.replies.push(payload);
    },
    async update(payload) {
      this.updates.push(payload);
    },
    ...overrides,
  };
}

test('relocate action rejects an empty location without querying', async () => {
  const interaction = makeInteraction({ values: [] });
  const session = makeSession();

  const handled = await handleSearchAction(
    interaction,
    'relocate',
    session,
    {
      queryVehicles: async () => assert.fail('query should not run'),
    }
  );

  assert.equal(handled, true);
  assert.deepEqual(interaction.replies, [
    { content: 'No location selected.', ephemeral: true },
  ]);
  assert.equal(session.searchState.location, 'boise');
});

test('previous action moves back one page and updates the shared session', async () => {
  const interaction = makeInteraction();
  const session = makeSession();
  session.searchState.currentPage = 1;
  session.searchState.totalPages = 2;
  session.searchState.vehicles = [
    {
      yard_name: 'BOISE',
      row_number: 7,
      vehicle_make: 'TOYOTA',
      vehicle_model: 'CAMRY',
      vehicle_year: 2005,
      first_seen: '2026-01-01T00:00:00.000Z',
      last_updated: '2026-01-02T00:00:00.000Z',
      notes: '',
    },
  ];

  await handleSearchAction(
    interaction,
    'previous',
    session,
    {}
  );

  assert.equal(session.searchState.currentPage, 0);
  assert.equal(interaction.updates.length, 1);
  assert.equal(
    interaction.updates[0].embeds[0].data.footer.text,
    'Page 1 of 2'
  );
});

test('unsave action reports when no saved search matches', async () => {
  const interaction = makeInteraction();

  await handleSearchAction(
    interaction,
    'unsave',
    makeSession(),
    {
      getSavedSearches: async () => [],
      deleteSavedSearch: async () => assert.fail('delete should not run'),
    }
  );

  assert.deepEqual(interaction.replies, [
    {
      content: 'This search is not currently saved.',
      ephemeral: true,
    },
  ]);
});

test('unsave action deletes every matching duplicate and keeps unrelated rows', async () => {
  const interaction = makeInteraction();
  const deletedIds = [];

  await handleSearchAction(
    interaction,
    'unsave',
    makeSession(),
    {
      getSavedSearches: async () => [
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
          yard_id: 1020,
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: '2005',
          status: 'ACTIVE',
        },
        {
          id: 3,
          yard_id: '1021',
          make: 'TOYOTA',
          model: 'CAMRY',
          year_range: '2005',
          status: 'ACTIVE',
        },
      ],
      deleteSavedSearch: async (id) => deletedIds.push(id),
    }
  );

  assert.deepEqual(deletedIds, [1, 2]);
  assert.deepEqual(interaction.replies, [
    {
      content: 'Removed 2 matching saved searches.',
      ephemeral: true,
    },
  ]);
});

test('unsave action redacts delete failures', async () => {
  const privateDetails = '/home/private/searches.db row=91';
  const interaction = makeInteraction();

  const consoleCalls = await captureConsole(() =>
    handleSearchAction(
      interaction,
      'unsave',
      makeSession(),
      {
        getSavedSearches: async () => [
          {
            id: 91,
            yard_id: '1020',
            make: 'TOYOTA',
            model: 'CAMRY',
            year_range: '2005',
            status: 'ACTIVE',
          },
        ],
        deleteSavedSearch: async () => {
          throw new RangeError(privateDetails);
        },
      }
    )
  );
  const output = joinedConsoleText(consoleCalls);

  assert.match(
    output,
    /Error deleting saved search: RangeError/
  );
  assert.equal(output.includes(privateDetails), false);
  assert.deepEqual(interaction.replies, [
    { content: 'Error deleting saved search.', ephemeral: true },
  ]);
});

test('unknown actions leave the interaction untouched', async () => {
  const interaction = makeInteraction();

  const handled = await handleSearchAction(
    interaction,
    'unknown',
    makeSession(),
    {}
  );

  assert.equal(handled, false);
  assert.deepEqual(interaction.replies, []);
  assert.deepEqual(interaction.updates, []);
});
