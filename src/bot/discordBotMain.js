const fs = require('node:fs');
const path = require('node:path');

const environmentPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(environmentPath)) process.loadEnvFile(environmentPath);
const { Events } = require('discord.js');
const { summarizeError } = require('../utils/errorSummary');

async function startDiscordBot(options = {}) {
  const botClient = options.client ?? require('./utils/client.js').client;
  const setupDatabase =
    options.setupDatabase ?? require('../database/database').setupDatabase;
  const token = options.token ?? process.env.TOKEN;

  await setupDatabase();
  console.log('Database setup completed successfully.');

  const startScheduledTasks =
    options.startScheduledTasks ??
    require('../notifications/scheduler').startScheduledTasks;
  const handleInteraction =
    options.handleInteraction ??
    require('./handlers/interactionHandler').handleInteraction;
  let readyHandled = false;

  botClient.on(Events.ClientReady, async () => {
    console.log('✅ Discord bot is online. ✅');
    if (readyHandled) {
      console.log('Ready event received again; scheduled tasks already initialized.');
      return;
    }

    readyHandled = true;
    try {
      await startScheduledTasks();
      console.log('Scheduled tasks started.');
      console.log('Current server time:', new Date().toLocaleString());
    } catch (error) {
      readyHandled = false;
      console.error('Failed to start scheduled tasks:', summarizeError(error));
    }
  });
  botClient.on(Events.InteractionCreate, handleInteraction);

  await botClient.login(token);
  return botClient;
}

function runDiscordBotCli(start = startDiscordBot) {
  return Promise.resolve()
    .then(() => start())
    .catch((error) => {
      console.error('Failed to start Discord bot:', summarizeError(error));
      process.exitCode = 1;
    });
}

if (require.main === module) {
  runDiscordBotCli();
}

module.exports = {
  runDiscordBotCli,
  startDiscordBot,
};
