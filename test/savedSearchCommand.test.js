const test = require('node:test');
const assert = require('node:assert/strict');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  createSavedSearch,
  createSavedSearchCommand,
  makeInteraction,
} = require('../test-support/savedSearchCommandHarness');

test('savedsearch command replies when the user has no saved searches', async () => {
  const interaction = makeInteraction('user-empty');
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [],
  });

  const consoleCalls = await captureConsole(() => runCommand(interaction));

  assert.equal(interaction.deferReplyCalls.length, 1);
  assert.equal(interaction.deferReplyCalls[0].ephemeral, true);
  assert.equal(interaction.editReplyCalls.length, 1);
  assert.match(interaction.editReplyCalls[0].content, /no saved searches/i);
  assert.equal(joinedConsoleText(consoleCalls).includes('user-empty'), false);
});

test('savedsearch command resolves an optional location before loading', async () => {
  const interaction = makeInteraction('user-filtered', 'boise');
  const calls = [];
  const runCommand = createSavedSearchCommand({
    convertLocationToYardId(location) {
      calls.push(['location', location]);
      return 1020;
    },
    async getSavedSearches(userId, yardId) {
      calls.push(['load', userId, yardId]);
      return [];
    },
  });

  await runCommand(interaction);

  assert.deepEqual(calls, [
    ['location', 'boise'],
    ['load', 'user-filtered', 1020],
  ]);
  assert.match(interaction.editReplyCalls[0].content, /no saved searches/i);
});

test('savedsearch command renders an in-channel carousel', async () => {
  const interaction = makeInteraction('user-has-searches');
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => [
      createSavedSearch({ year_range: '2000-2005' }),
    ],
  });

  await runCommand(interaction);

  assert.equal(interaction.editReplyCalls.length, 1);
  const initialPayload = interaction.editReplyCalls[0];
  assert.ok(Array.isArray(initialPayload.embeds));
  assert.ok(Array.isArray(initialPayload.components));
  assert.deepEqual(
    initialPayload.components[0].components.map(
      (button) => button.data.label
    ),
    ['Prev Saved', 'Next Saved', 'Run', 'Delete', 'Pause Alerts']
  );
});

test('savedsearch command redacts retrieval errors', async () => {
  const privateErrorDetails = 'private user /home/kc/private-inventory.db';
  const interaction = makeInteraction('private-user');
  const runCommand = createSavedSearchCommand({
    getSavedSearches: async () => {
      throw new TypeError(privateErrorDetails);
    },
  });

  const consoleCalls = await captureConsole(() => runCommand(interaction));

  assert.deepEqual(interaction.editReplyCalls, [
    { content: 'Failed to retrieve saved searches.' },
  ]);
  assert.match(
    joinedConsoleText(consoleCalls),
    /Error retrieving saved searches: TypeError/
  );
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});
