const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const searchCommandPath = path.join(repoRoot, 'src/bot/commands/searchCommand.js');
const searchInteractionActionsPath = path.join(
  repoRoot,
  'src/bot/handlers/searchInteractionActions.js'
);
const searchInteractionCollectorPath = path.join(
  repoRoot,
  'src/bot/handlers/searchInteractionCollector.js'
);
const vehicleQueryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');
const savedSearchManagerPath = path.join(repoRoot, 'src/database/savedSearchManager.js');

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

function restoreCachedModule(modulePath, previousModule) {
  if (previousModule) {
    require.cache[modulePath] = previousModule;
  } else {
    delete require.cache[modulePath];
  }
}

async function withSearchCommandMocks(mocks, runTest) {
  const cachedModules = new Map(
    [
      searchCommandPath,
      searchInteractionActionsPath,
      searchInteractionCollectorPath,
      vehicleQueryManagerPath,
      savedSearchManagerPath,
    ].map((modulePath) => [modulePath, require.cache[modulePath]])
  );

  require.cache[vehicleQueryManagerPath] = {
    id: vehicleQueryManagerPath,
    filename: vehicleQueryManagerPath,
    loaded: true,
    exports: {
      queryVehicles: mocks.queryVehicles,
      getModelSuggestionsForNoResults: mocks.getModelSuggestionsForNoResults || (async () => []),
    },
  };
  require.cache[savedSearchManagerPath] = {
    id: savedSearchManagerPath,
    filename: savedSearchManagerPath,
    loaded: true,
    exports: {
      getSavedSearches: mocks.getSavedSearches || (async () => []),
      deleteSavedSearch: mocks.deleteSavedSearch || (async () => {}),
      checkExistingSearch: mocks.checkExistingSearch || (async () => false),
      addSavedSearch: mocks.addSavedSearch || (async () => {}),
    },
  };
  delete require.cache[searchInteractionActionsPath];
  delete require.cache[searchInteractionCollectorPath];
  delete require.cache[searchCommandPath];

  try {
    await runTest(require(searchCommandPath));
  } finally {
    for (const [modulePath, previousModule] of cachedModules) {
      restoreCachedModule(modulePath, previousModule);
    }
  }
}

module.exports = {
  makeInteraction,
  makeSearchInteraction,
  makeVehicleRow,
  withSearchCommandMocks,
};
