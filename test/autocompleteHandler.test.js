const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const handlerPath = path.join(repoRoot, 'src/bot/handlers/autocompleteHandler.js');
const vehicleQueryManagerPath = path.join(repoRoot, 'src/database/vehicleQueryManager.js');

async function withAutocompleteMocks(getModelSuggestions, runTest) {
  const previousHandler = require.cache[handlerPath];
  const previousVehicleQueryManager = require.cache[vehicleQueryManagerPath];

  require.cache[vehicleQueryManagerPath] = {
    id: vehicleQueryManagerPath,
    filename: vehicleQueryManagerPath,
    loaded: true,
    exports: {
      getModelSuggestions,
    },
  };
  delete require.cache[handlerPath];

  try {
    const moduleExports = require(handlerPath);
    await runTest(moduleExports);
  } finally {
    if (previousHandler) require.cache[handlerPath] = previousHandler;
    else delete require.cache[handlerPath];

    if (previousVehicleQueryManager) require.cache[vehicleQueryManagerPath] = previousVehicleQueryManager;
    else delete require.cache[vehicleQueryManagerPath];
  }
}

function makeAutocompleteInteraction({
  commandName = 'search',
  focusedName = 'make',
  focusedValue = '',
  selectedMake = null,
} = {}) {
  return {
    commandName,
    options: {
      getFocused(withMeta) {
        if (withMeta) {
          return { name: focusedName, value: focusedValue };
        }
        return focusedValue;
      },
      getString(name) {
        if (name === 'make') {
          return selectedMake;
        }
        return null;
      },
    },
    responses: [],
    async respond(choices) {
      this.responses.push(choices);
    },
  };
}

test('make autocomplete returns filtered uppercase make choices', async () => {
  await withAutocompleteMocks(
    async () => [],
    async ({ handleAutocompleteInteraction }) => {
      const interaction = makeAutocompleteInteraction({
        commandName: 'search',
        focusedName: 'make',
        focusedValue: 'toy',
      });

      await handleAutocompleteInteraction(interaction);

      assert.equal(interaction.responses.length, 1);
      const response = interaction.responses[0];
      assert.ok(response.length >= 1);
      assert.ok(response.every((choice) => choice.name.includes('TOY')));
      assert.ok(response.every((choice) => choice.value === choice.name));
    }
  );
});

test('model autocomplete uses selected make and focused value', async () => {
  const calls = [];
  await withAutocompleteMocks(
    async (make, focused, limit) => {
      calls.push({ make, focused, limit });
      return [{ model: 'CAMRY' }, { model: 'COROLLA' }];
    },
    async ({ handleAutocompleteInteraction }) => {
      const interaction = makeAutocompleteInteraction({
        commandName: 'search',
        focusedName: 'model',
        focusedValue: 'ca',
        selectedMake: 'toyota',
      });

      await handleAutocompleteInteraction(interaction);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].make, 'TOYOTA');
      assert.equal(calls[0].focused, 'CA');
      assert.equal(calls[0].limit, 25);
      assert.equal(interaction.responses.length, 1);
      assert.deepEqual(interaction.responses[0], [
        { name: 'CAMRY', value: 'CAMRY' },
        { name: 'COROLLA', value: 'COROLLA' },
      ]);
    }
  );
});

test('make autocomplete recognizes common aliases while returning the canonical make', async () => {
  await withAutocompleteMocks(async () => [], async ({ handleAutocompleteInteraction }) => {
    for (const [typed, canonical] of [['vw', 'VOLKSWAGEN'], ['chevy', 'CHEVROLET']]) {
      const interaction = makeAutocompleteInteraction({ focusedValue: typed });
      await handleAutocompleteInteraction(interaction);
      assert(interaction.responses[0].some((choice) => choice.value === canonical));
    }
  });
});

test('model autocomplete normalizes make aliases before querying suggestions', async () => {
  const calls = [];
  await withAutocompleteMocks(
    async (make) => {
      calls.push(make);
      return [];
    },
    async ({ handleAutocompleteInteraction }) => {
      const interaction = makeAutocompleteInteraction({
        commandName: 'search',
        focusedName: 'model',
        focusedValue: '',
        selectedMake: 'chevy',
      });

      await handleAutocompleteInteraction(interaction);
      assert.deepEqual(calls, ['CHEVROLET']);
      assert.equal(interaction.responses.length, 1);
    }
  );
});

test('autocomplete responds with empty array for unsupported focused option', async () => {
  await withAutocompleteMocks(
    async () => [],
    async ({ handleAutocompleteInteraction }) => {
      const interaction = makeAutocompleteInteraction({
        commandName: 'search',
        focusedName: 'status',
        focusedValue: 'A',
      });

      await handleAutocompleteInteraction(interaction);
      assert.equal(interaction.responses.length, 1);
      assert.deepEqual(interaction.responses[0], []);
    }
  );
});

test('autocomplete redacts lookup and response errors', async () => {
  const lookupDetails = 'private lookup /home/kc/private-inventory.db';
  const responseDetails = 'private Discord user 123456789';

  await withAutocompleteMocks(
    async () => {
      throw new TypeError(lookupDetails);
    },
    async ({ handleAutocompleteInteraction }) => {
      const interaction = makeAutocompleteInteraction({
        commandName: 'search',
        focusedName: 'model',
        focusedValue: 'ca',
        selectedMake: 'toyota',
      });
      interaction.respond = async () => {
        throw new RangeError(responseDetails);
      };

      const consoleCalls = await captureConsole(async () => {
        await handleAutocompleteInteraction(interaction);
      });
      const consoleText = joinedConsoleText(consoleCalls);

      assert.match(consoleText, /Autocomplete interaction error: TypeError/);
      assert.match(consoleText, /Failed to respond to autocomplete interaction: RangeError/);
      assert.equal(consoleText.includes(lookupDetails), false);
      assert.equal(consoleText.includes(responseDetails), false);
    }
  );
});
