const test = require('node:test');
const assert = require('node:assert/strict');
const { withInteractionResponses } = require('../test-support/interactionResponses');
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
  return withInteractionResponses({
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
  });
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

test('model suggestion rejects stale values without querying or changing the filter', async () => {
  const session = makeSession();
  session.searchState.suggestedModels = ['CAMRY SOLARA'];
  const interaction = makeInteraction({ values: ['COROLLA'] });
  await handleSearchAction(interaction, 'model', session, {
    queryVehicles: async () => assert.fail('unexpected query'),
  });
  assert.match(interaction.replies[0].content, /suggestion has expired/);
  assert.deepEqual(session.criteria, criteria);
});

test('failed model suggestion rendering cannot silently change the filter that gets saved', async () => {
  const session = makeSession();
  session.searchState.suggestedModels = ['CAMRY SOLARA'];
  const originalState = session.searchState;
  const interaction = makeInteraction({
    values: ['CAMRY SOLARA'],
    async update() { throw new Error('fixture failed update'); },
  });
  await assert.rejects(handleSearchAction(interaction, 'model', session, {
    queryVehicles: async () => [],
    getModelSuggestionsForNoResults: async () => [],
  }), /fixture failed update/);
  assert.deepEqual(interaction.responseMethods, ['deferUpdate', 'editReply']);
  assert.equal(session.searchState, originalState);
  assert.deepEqual(session.criteria, criteria);
});

test('manage action explains how to create the first alert', async () => {
  const interaction = makeInteraction();

  await handleSearchAction(
    interaction,
    'manage',
    makeSession(),
    {
      getSavedSearches: async () => [],
      deleteSavedSearch: async () => assert.fail('delete should not run'),
    }
  );

  assert.match(interaction.replies[0].content, /no saved alerts.*Save Alert/);
  assert.deepEqual(interaction.responseMethods, ['deferReply', 'editReply']);
});

test('removed unsave action cannot silently delete saved records', async () => {
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

  assert.deepEqual(deletedIds, []);
  assert.deepEqual(interaction.replies, []);
});

test('manage action redacts lookup failures', async () => {
  const privateDetails = '/home/private/searches.db row=91';
  const interaction = makeInteraction();

  const consoleCalls = await captureConsole(() =>
    handleSearchAction(
      interaction,
      'manage',
      makeSession(),
      {
        getSavedSearches: async () => {
          throw new RangeError(privateDetails);
        },
      }
    )
  );
  const output = joinedConsoleText(consoleCalls);

  assert.match(
    output,
    /Error retrieving saved searches: RangeError/
  );
  assert.equal(output.includes(privateDetails), false);
  assert.deepEqual(interaction.replies, [
    { content: 'Failed to retrieve saved searches.' },
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
