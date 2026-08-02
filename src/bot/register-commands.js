const path = require('node:path');
const { REST, Routes } = require('discord.js');

const { buildCommandDefinitions } = require('./commandDefinitions');

const REQUIRED_ENVIRONMENT_VARIABLES = Object.freeze([
  'TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
]);

function readRegistrationConfig(environment = process.env) {
  const missingVariables = REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => (
    typeof environment[name] !== 'string' || environment[name].trim() === ''
  ));

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing required Discord registration configuration: ${missingVariables.join(', ')}`
    );
  }

  return {
    token: environment.TOKEN.trim(),
    clientId: environment.CLIENT_ID.trim(),
    guildId: environment.GUILD_ID.trim(),
  };
}

async function registerCommands({ environment = process.env, rest } = {}) {
  const { token, clientId, guildId } = readRegistrationConfig(environment);
  const commandDefinitions = buildCommandDefinitions();
  const discordRest = rest || new REST({ version: '10' }).setToken(token);

  await discordRest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commandDefinitions }
  );

  return commandDefinitions;
}

async function registerCommandsFromEnvironment({
  environment = process.env,
  environmentPath = path.resolve(__dirname, '../.env'),
  rest,
} = {}) {
  require('dotenv').config({ path: environmentPath });
  console.log('Registering slash commands...');
  const commandDefinitions = await registerCommands({ environment, rest });
  console.log('Slash commands were registered successfully!');
  return commandDefinitions;
}

if (require.main === module) {
  registerCommandsFromEnvironment().catch((error) => {
    console.error('Failed to register slash commands:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_ENVIRONMENT_VARIABLES,
  readRegistrationConfig,
  registerCommands,
  registerCommandsFromEnvironment,
};
