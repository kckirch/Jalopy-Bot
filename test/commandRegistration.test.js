const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits, Routes } = require('discord.js');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const {
  ALL_LOCATION_CHOICE,
  TREASURE_VALLEY_CHOICE,
  YARD_LOCATION_CHOICES,
  buildCommandDefinitions,
} = require('../src/bot/commandDefinitions');
const {
  readRegistrationConfig,
  registerCommands,
  registerCommandsFromEnvironment,
  runRegistrationCli,
} = require('../src/bot/register-commands');

const registrationEnvironment = {
  TOKEN: ' test-token ',
  CLIENT_ID: ' test-client-id ',
  GUILD_ID: ' test-guild-id ',
};

function getCommand(commands, name) {
  return commands.find((command) => command.name === name);
}

function getOption(command, name) {
  return command.options.find((option) => option.name === name);
}

function simplifyChoices(choices) {
  return choices.map(({ name, value }) => ({ name, value }));
}

test('command definitions preserve the complete registered command set', () => {
  const commands = buildCommandDefinitions();

  assert.deepEqual(
    commands.map((command) => command.name),
    [
      'scrape',
      'search',
      'savedsearch',
      'runtestscheduler',
      'commands',
    ]
  );

  const elevatedCommands = new Set([
    'scrape',
    'runtestscheduler',
  ]);
  for (const command of commands) {
    const expectedPermissions = elevatedCommands.has(command.name)
      ? PermissionFlagsBits.ManageGuild.toString()
      : undefined;
    assert.equal(command.default_member_permissions, expectedPermissions, command.name);
  }
});

test('location choices stay consistent across command definitions', () => {
  const commands = buildCommandDefinitions();
  const yardChoices = YARD_LOCATION_CHOICES.map((choice) => ({ ...choice }));
  const allChoice = { ...ALL_LOCATION_CHOICE };
  const treasureValleyChoice = { ...TREASURE_VALLEY_CHOICE };

  assert.deepEqual(
    simplifyChoices(getOption(getCommand(commands, 'scrape'), 'location').choices),
    [...yardChoices, allChoice]
  );

  const searchChoices = [...yardChoices, treasureValleyChoice, allChoice];
  assert.deepEqual(
    simplifyChoices(getOption(getCommand(commands, 'search'), 'location').choices),
    searchChoices
  );
  assert.deepEqual(
    simplifyChoices(getOption(getCommand(commands, 'savedsearch'), 'location').choices),
    searchChoices
  );
});

test('search definition preserves autocomplete and status options', () => {
  const searchCommand = getCommand(buildCommandDefinitions(), 'search');

  assert.equal(getOption(searchCommand, 'location').required, true);
  assert.equal(getOption(searchCommand, 'make').autocomplete, true);
  assert.equal(getOption(searchCommand, 'model').autocomplete, true);
  assert.deepEqual(simplifyChoices(getOption(searchCommand, 'status').choices), [
    { name: 'New', value: 'NEW' },
    { name: 'Active (Includes New)', value: 'ACTIVE' },
    { name: 'Inactive', value: 'INACTIVE' },
  ]);
});

test('readRegistrationConfig validates and normalizes required values', () => {
  assert.deepEqual(readRegistrationConfig(registrationEnvironment), {
    token: 'test-token',
    clientId: 'test-client-id',
    guildId: 'test-guild-id',
  });

  assert.throws(
    () => readRegistrationConfig({ TOKEN: '', CLIENT_ID: 'client-id' }),
    /TOKEN, GUILD_ID/
  );
});

test('registerCommands sends the tested definitions to the configured guild route', async () => {
  const calls = [];
  const rest = {
    async put(route, payload) {
      calls.push({ route, payload });
    },
  };

  const commands = await registerCommands({
    environment: registrationEnvironment,
    rest,
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].route,
    Routes.applicationGuildCommands('test-client-id', 'test-guild-id')
  );
  assert.deepEqual(calls[0].payload, { body: commands });
  assert.deepEqual(commands, buildCommandDefinitions());
});

test('registerCommandsFromEnvironment remains injectable for isolated execution', async () => {
  const calls = [];
  const logCalls = [];
  const originalConsoleLog = console.log;
  let commands;

  console.log = (...args) => logCalls.push(args.join(' '));
  try {
    commands = await registerCommandsFromEnvironment({
      environment: registrationEnvironment,
      environmentPath: '/path/that/does/not/exist/.env',
      rest: {
        async put(route, payload) {
          calls.push({ route, payload });
        },
      },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { body: commands });
  assert.deepEqual(logCalls, [
    'Registering slash commands...',
    'Slash commands were registered successfully!',
  ]);
});

test('registration CLI redacts failures and sets a failing exit code', async () => {
  const privateErrorDetails = 'private Discord token /home/kc/private.env';
  const previousExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    const consoleCalls = await captureConsole(async () => {
      await runRegistrationCli(async () => {
        throw new TypeError(privateErrorDetails);
      });
    });

    assert.equal(process.exitCode, 1);
    assert.match(
      joinedConsoleText(consoleCalls),
      /Failed to register slash commands: TypeError/
    );
    assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
  } finally {
    process.exitCode = previousExitCode;
  }
});
