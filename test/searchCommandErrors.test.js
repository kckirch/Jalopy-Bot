const test = require('node:test');
const assert = require('node:assert/strict');

const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  makeSearchInteraction,
  makeVehicleRow,
  withSearchCommandMocks,
} = require('../test-support/searchCommandHarness');

test('search command redacts initial query errors', async () => {
  const privateErrorDetails = 'private query /home/kc/private-inventory.db';
  const interaction = makeSearchInteraction();

  const consoleCalls = await captureConsole(async () => {
    await withSearchCommandMocks(
      {
        queryVehicles: async () => {
          throw new TypeError(privateErrorDetails);
        },
      },
      async ({ handleSearchCommand }) => handleSearchCommand(interaction)
    );
  });

  assert.deepEqual(interaction.replies, [
    {
      content: 'Error fetching data from the database.',
    },
  ]);
  assert.match(joinedConsoleText(consoleCalls), /Error querying vehicles: TypeError/);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('search command redacts save-check errors', async () => {
  const privateErrorDetails = 'private saved search /home/kc/private-inventory.db';
  const interaction = makeSearchInteraction();

  await withSearchCommandMocks(
    {
      queryVehicles: async () => [makeVehicleRow()],
      checkExistingSearch: async () => {
        throw new RangeError(privateErrorDetails);
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
      const customId = interaction.replies[0].components[0].components[2].data.custom_id;
      const buttonInteraction = {
        customId,
        user: { id: 'user-1', tag: 'user-1#0001' },
        replyCalls: [],
        async reply(payload) {
          this.replyCalls.push(payload);
        },
        async update() {},
      };

      const consoleCalls = await captureConsole(async () => {
        await interaction.message.collector.emitCollect(buttonInteraction);
      });

      assert.deepEqual(buttonInteraction.replyCalls, [
        {
          content: 'Unable to confirm this save. Check `/savedsearch` before trying again.',
        },
      ]);
      assert.match(
        joinedConsoleText(consoleCalls),
        /Error checking for existing search: RangeError/
      );
      assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
    }
  );
});

test('search command redacts outer collector errors', async () => {
  const privateErrorDetails = 'private relocated query /home/kc/private-inventory.db';
  const interaction = makeSearchInteraction();
  let queryCalls = 0;

  await withSearchCommandMocks(
    {
      queryVehicles: async () => {
        queryCalls += 1;
        if (queryCalls === 1) {
          return [makeVehicleRow()];
        }
        throw new EvalError(privateErrorDetails);
      },
    },
    async ({ handleSearchCommand }) => {
      await handleSearchCommand(interaction);
      const customId = interaction.replies[0].components[2].components[0].data.custom_id;
      const selectInteraction = {
        customId,
        values: ['caldwell'],
        user: { id: 'user-1', tag: 'user-1#0001' },
        replyCalls: [],
        async reply(payload) {
          this.replyCalls.push(payload);
        },
        async update() {},
      };

      const consoleCalls = await captureConsole(async () => {
        await interaction.message.collector.emitCollect(selectInteraction);
      });

      assert.deepEqual(selectInteraction.replyCalls, [
        {
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        },
      ]);
      assert.match(
        joinedConsoleText(consoleCalls),
        /Error processing button interaction: EvalError/
      );
      assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
    }
  );
});
