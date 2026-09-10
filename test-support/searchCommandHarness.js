const { handleSearchCommand } = require('../src/bot/commands/searchCommand');

class FakeCollector {
  constructor() {
    this.handlers = {};
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
    return this;
  }

  async emitCollect(interaction) {
    if (this.handlers.collect) {
      await this.handlers.collect(interaction);
    }
  }

  async emitEnd(...args) {
    if (this.handlers.end) {
      await this.handlers.end(...args);
    }
  }
}

function makeMessage() {
  return {
    collector: null,
    edits: [],
    createMessageComponentCollector() {
      this.collector = new FakeCollector();
      return this.collector;
    },
    async edit(payload) {
      this.edits.push(payload);
    },
  };
}

function makeInteraction(options, userId = 'user-1') {
  const message = makeMessage();
  const replies = [];

  return {
    options: {
      getString(name) {
        return options[name] ?? null;
      },
    },
    user: {
      id: userId,
      tag: `${userId}#0001`,
    },
    async reply(payload) {
      replies.push(payload);
      if (payload && payload.fetchReply) {
        return message;
      }
      return payload;
    },
    replies,
    message,
  };
}

function makeSearchInteraction(overrides = {}) {
  return makeInteraction({
    location: 'boise',
    make: 'TOYOTA',
    model: 'CAMRY',
    year: '2005',
    status: 'ACTIVE',
    ...overrides,
  });
}

function makeVehicleRow(overrides = {}) {
  const now = new Date().toISOString();
  return {
    yard_name: 'BOISE',
    row_number: 7,
    vehicle_make: 'TOYOTA',
    vehicle_model: 'CAMRY',
    vehicle_year: 2005,
    first_seen: now,
    last_updated: now,
    notes: '',
    ...overrides,
  };
}

async function withSearchCommandMocks(mocks, runTest) {
  const dependencies = {
    queryVehicles: mocks.queryVehicles,
    getModelSuggestionsForNoResults: mocks.getModelSuggestionsForNoResults || (async () => []),
    getSavedSearches: mocks.getSavedSearches || (async () => []),
    deleteSavedSearch: mocks.deleteSavedSearch || (async () => {}),
    checkExistingSearch: mocks.checkExistingSearch || (async () => false),
    addSavedSearch: mocks.addSavedSearch || (async () => {}),
  };
  await runTest({
    handleSearchCommand: (interaction) => handleSearchCommand(interaction, dependencies),
  });
}

module.exports = {
  makeInteraction,
  makeSearchInteraction,
  makeVehicleRow,
  withSearchCommandMocks,
};
