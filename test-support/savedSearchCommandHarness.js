const {
  handleSavedSearchCommand,
} = require('../src/bot/commands/savedSearchCommand');
const { withInteractionResponses } = require('./interactionResponses');
const {
  startSavedSearchSession,
} = require('../src/bot/handlers/savedSearchSessionHandler');

class FakeCollector {
  constructor() {
    this.handlers = {};
    this.stopCalls = [];
  }

  on(eventName, handler) {
    this.handlers[eventName] = handler;
    return this;
  }

  async emitCollect(interaction) {
    if (this.handlers.collect) {
      await this.handlers.collect(withInteractionResponses(interaction));
    }
  }

  async emitEnd(...args) {
    if (this.handlers.end) {
      await this.handlers.end(...args);
    }
  }

  stop(reason) {
    this.stopCalls.push(reason);
  }
}

function createSavedSearch(overrides = {}) {
  return {
    id: 1,
    yard_id: '1020',
    yard_name: 'BOISE',
    make: 'TOYOTA',
    model: 'CAMRY',
    year_range: 'ANY',
    status: 'ACTIVE',
    frequency: 'daily',
    create_date: new Date().toISOString(),
    update_date: new Date().toISOString(),
    ...overrides,
  };
}

function createSavedSearchCommand(mocks = {}) {
  const sessionDependencies = {
    deleteSavedSearch: mocks.deleteSavedSearch || (async () => {}),
    getModelSuggestionsForNoResults:
      mocks.getModelSuggestionsForNoResults || (async () => []),
    queryVehicles: mocks.queryVehicles || (async () => []),
    setSavedSearchFrequency:
      mocks.setSavedSearchFrequency || (async () => {}),
  };
  const commandDependencies = {
    convertLocationToYardId: mocks.convertLocationToYardId,
    getSavedSearches: mocks.getSavedSearches || (async () => []),
    startSavedSearchSession(interaction, savedSearches) {
      return startSavedSearchSession(
        interaction,
        savedSearches,
        sessionDependencies
      );
    },
  };

  return (interaction) =>
    handleSavedSearchCommand(interaction, commandDependencies);
}

function getButtonByLabel(payload, label) {
  return payload.components.flatMap((row) => row.components).find(
    (button) => button.data.label === label
  );
}

function emitCollectorAction(
  interaction,
  { customId, userId, onReply = async () => {}, onUpdate = async () => {} }
) {
  return interaction.__collector.emitCollect({
    customId,
    user: { id: userId },
    reply: onReply,
    update: onUpdate,
  });
}

function makeInteraction(userId = 'user-1', location = null) {
  const collector = new FakeCollector();
  const replyMessage = {
    createMessageComponentCollector: () => collector,
  };

  return {
    user: {
      id: userId,
      tag: `${userId}#0001`,
    },
    options: {
      getString(name) {
        return name === 'location' ? location : null;
      },
    },
    deferReplyCalls: [],
    editReplyCalls: [],
    async deferReply(payload) {
      this.deferReplyCalls.push(payload);
    },
    async editReply(payload) {
      this.editReplyCalls.push(payload);
    },
    async fetchReply() {
      return replyMessage;
    },
    __collector: collector,
  };
}

function makeVehicleRow(index) {
  return {
    vehicle_year: 2000 + index,
    vehicle_make: 'TOYOTA',
    vehicle_model: 'CAMRY',
    yard_name: 'BOISE',
    row_number: index + 1,
    first_seen: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    last_updated: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
  };
}

module.exports = {
  createSavedSearch,
  createSavedSearchCommand,
  emitCollectorAction,
  getButtonByLabel,
  makeInteraction,
  makeVehicleRow,
};
