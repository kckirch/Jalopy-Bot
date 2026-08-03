const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSavedSearch,
  createSavedSearchCommand,
  emitCollectorAction,
  getButtonByLabel,
  makeInteraction,
  makeVehicleRow,
} = require('../test-support/savedSearchCommandHarness');

test('run switches to search-style results with pagination controls', async () => {
  const interaction = makeInteraction('user-run-test');
  let updatedPayload;
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [createSavedSearch({ id: 99 })],
    queryVehicles: async () => [makeVehicleRow(0)],
  });

  await runCommand(interaction);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(interaction.editReplyCalls[0], 'Run').data
      .custom_id,
    userId: 'user-run-test',
    async onUpdate(payload) {
      updatedPayload = payload;
    },
  });

  const embedData = updatedPayload.embeds[0].data;
  assert.match(embedData.title, /Database search results for/i);
  assert.ok(embedData.fields.some((field) => /TOYOTA CAMRY/i.test(field.name)));
  assert.deepEqual(
    updatedPayload.components[0].components.map(
      (button) => button.data.label
    ),
    ['Previous', 'Next', 'Back To Saved', 'Delete', 'Pause Alerts']
  );
});

test('result pagination remains inside the active session', async () => {
  const interaction = makeInteraction('user-results-pages');
  const updates = [];
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [createSavedSearch({ id: 100 })],
    queryVehicles: async () =>
      Array.from({ length: 21 }, (_, index) => makeVehicleRow(index)),
  });

  await runCommand(interaction);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(interaction.editReplyCalls[0], 'Run').data
      .custom_id,
    userId: 'user-results-pages',
    async onUpdate(payload) {
      updates.push(payload);
    },
  });
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(updates[0], 'Next').data.custom_id,
    userId: 'user-results-pages',
    async onUpdate(payload) {
      updates.push(payload);
    },
  });
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(updates[1], 'Previous').data.custom_id,
    userId: 'user-results-pages',
    async onUpdate(payload) {
      updates.push(payload);
    },
  });

  assert.deepEqual(
    updates.map((payload) => payload.embeds[0].data.footer.text),
    ['Page 1 of 2', 'Page 2 of 2', 'Page 1 of 2']
  );
});

test('stale result controls and unknown actions receive bounded replies', async () => {
  const interaction = makeInteraction('user-stale-actions');
  const replies = [];
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [
      createSavedSearch({ id: 102, make: 'HONDA', model: 'CIVIC' }),
    ],
  });

  await runCommand(interaction);
  const onReply = async (payload) => replies.push(payload);
  await emitCollectorAction(interaction, {
    customId: 'rnext',
    userId: 'user-stale-actions',
    onReply,
  });
  await emitCollectorAction(interaction, {
    customId: 'unknown',
    userId: 'user-stale-actions',
    onReply,
  });

  assert.deepEqual(replies, [
    {
      content: 'No search results are currently active.',
      ephemeral: true,
    },
    { content: 'Unknown action.', ephemeral: true },
  ]);
});

test('back returns from results to the saved-search carousel', async () => {
  const interaction = makeInteraction('user-back-test');
  const updates = [];
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [createSavedSearch({ id: 101 })],
    queryVehicles: async () => [makeVehicleRow(0)],
  });

  await runCommand(interaction);
  const onUpdate = async (payload) => updates.push(payload);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(interaction.editReplyCalls[0], 'Run').data
      .custom_id,
    userId: 'user-back-test',
    onUpdate,
  });
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(updates[0], 'Back To Saved').data.custom_id,
    userId: 'user-back-test',
    onUpdate,
  });

  assert.match(updates[0].embeds[0].data.title, /Database search results/i);
  assert.match(updates[1].embeds[0].data.title, /Saved Search:/i);
  assert.deepEqual(
    updates[1].components[0].components.map(
      (button) => button.data.label
    ),
    ['Prev Saved', 'Next Saved', 'Run', 'Delete', 'Pause Alerts']
  );
});

test('next and previous cycle through saved searches in place', async () => {
  const interaction = makeInteraction('user-nav-test');
  const updates = [];
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [
      createSavedSearch(),
      createSavedSearch({
        id: 2,
        yard_id: '1021',
        yard_name: 'CALDWELL',
        make: 'HONDA',
        model: 'ACCORD',
      }),
    ],
  });

  await runCommand(interaction);
  const onUpdate = async (payload) => updates.push(payload);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(
      interaction.editReplyCalls[0],
      'Next Saved'
    ).data.custom_id,
    userId: 'user-nav-test',
    onUpdate,
  });
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(updates[0], 'Prev Saved').data.custom_id,
    userId: 'user-nav-test',
    onUpdate,
  });

  assert.match(updates[0].embeds[0].data.title, /HONDA ACCORD/i);
  assert.match(updates[1].embeds[0].data.title, /TOYOTA CAMRY/i);
});
