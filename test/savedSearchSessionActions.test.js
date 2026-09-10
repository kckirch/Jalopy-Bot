const test = require('node:test');
const assert = require('node:assert/strict');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  createSavedSearch,
  createSavedSearchCommand,
  emitCollectorAction,
  getButtonByLabel,
  makeInteraction,
} = require('../test-support/savedSearchCommandHarness');

test('pause toggles alerts and persists the paused frequency', async () => {
  const interaction = makeInteraction('user-pause-test');
  const frequencyUpdates = [];
  let updatedPayload;
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [
      createSavedSearch({ id: 55, make: 'HONDA', model: 'CIVIC' }),
    ],
    async setSavedSearchFrequency(searchId, frequency) {
      frequencyUpdates.push([searchId, frequency]);
    },
  });

  await runCommand(interaction);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(
      interaction.editReplyCalls[0],
      'Pause Alerts'
    ).data.custom_id,
    userId: 'user-pause-test',
    async onUpdate(payload) {
      updatedPayload = payload;
    },
  });

  assert.deepEqual(frequencyUpdates, [[55, 'paused']]);
  assert.ok(getButtonByLabel(updatedPayload, 'Resume Alerts'));
  assert.match(updatedPayload.embeds[0].data.description, /alerts:\s+paused/i);
});

test('delete removes the final saved search and clears the message', async () => {
  const interaction = makeInteraction('user-delete-test');
  const deleteCalls = [];
  let updatedPayload;
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [
      createSavedSearch({ id: 42, make: 'HONDA', model: 'CIVIC' }),
    ],
    async deleteSavedSearch(id) {
      deleteCalls.push(id);
    },
  });

  await runCommand(interaction);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(interaction.editReplyCalls[0], 'Delete').data
      .custom_id,
    userId: 'user-delete-test',
    async onUpdate(payload) {
      updatedPayload = payload;
    },
  });

  assert.deepEqual(deleteCalls, []);
  assert.match(updatedPayload.content, /Remove this saved alert/);
  await emitCollectorAction(interaction, {
    customId: getButtonByLabel(updatedPayload, 'Remove Alert').data.custom_id,
    userId: 'user-delete-test',
    async onUpdate(payload) { updatedPayload = payload; },
  });
  assert.deepEqual(deleteCalls, [42]);
  assert.match(updatedPayload.content, /no saved alerts left/i);
  assert.deepEqual(updatedPayload.components, []);
  assert.deepEqual(interaction.__collector.stopCalls, ['all_deleted']);
});

test('collector end disables components on the ephemeral reply', async () => {
  const interaction = makeInteraction('user-end-test');
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [createSavedSearch()],
  });

  await runCommand(interaction);
  await interaction.__collector.emitEnd([], 'time');

  assert.equal(interaction.editReplyCalls.length, 2);
  assert.deepEqual(interaction.editReplyCalls[1].components, []);
});

test('collector action failures are redacted and receive a bounded reply', async () => {
  const privateErrorDetails = 'private saved search /home/kc/private-inventory.db';
  const interaction = makeInteraction('user-collector-error');
  const buttonReplies = [];
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [createSavedSearch({ id: 81 })],
    deleteSavedSearch: async () => {
      throw new RangeError(privateErrorDetails);
    },
  });

  await runCommand(interaction);
  await emitCollectorAction(interaction, {
    customId: 'delete:0:81',
    userId: 'user-collector-error',
  });
  const consoleCalls = await captureConsole(() =>
    emitCollectorAction(interaction, {
      customId: 'confirm-delete:0:81',
      userId: 'user-collector-error',
      async onReply(payload) {
        buttonReplies.push(payload);
      },
    })
  );

  assert.deepEqual(buttonReplies, [
    {
      content: 'Unable to confirm that action. Reopen `/savedsearch` to check its current state before trying again.',
      ephemeral: true,
    },
  ]);
  assert.match(
    joinedConsoleText(consoleCalls),
    /Saved search interaction failed: RangeError/
  );
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('carousel cleanup failures are redacted', async () => {
  const privateErrorDetails = 'private message /home/kc/private-inventory.db';
  const interaction = makeInteraction('user-cleanup-error');
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [
      createSavedSearch({ id: 82, make: 'HONDA', model: 'CIVIC' }),
    ],
  });

  await runCommand(interaction);
  interaction.editReply = async () => {
    throw new SyntaxError(privateErrorDetails);
  };

  const consoleCalls = await captureConsole(() =>
    interaction.__collector.emitEnd([], 'time')
  );

  assert.match(
    joinedConsoleText(consoleCalls),
    /Unable to disable saved-search carousel buttons: SyntaxError/
  );
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});
