const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { client } = require('./utils/client.js');
const { setupDatabase } = require('../database/database');
const { startScheduledTasks } = require('../notifications/scheduler');
const { handleButtonClick } = require('./handlers/buttonClickHandler');
const { handleAutocompleteInteraction } = require('./handlers/autocompleteHandler');

const { handleScrapeCommand } = require('./commands/scrapeCommand');
const { handleSearchCommand } = require('./commands/searchCommand');
const { handleSavedSearchCommand } = require('./commands/savedSearchCommand');
const { handleDailySavedSearchCommand } = require('./commands/dailySavedSearchCommand');
const { handleRunTestSchedulerCommand } = require('./commands/runTestSchedulerCommand');
const { handleCommandsCommand } = require('./commands/commandsCommand');
const { handleManualNotifyNewVehiclesCommand } = require('./commands/manualNotifyNewVehiclesCommand');
const { handleRunTestGitPushDBCommand } = require('./commands/testGitPushDB');
const { ensureElevatedCommandAccess } = require('./utils/commandPermissions');
let readyHandled = false;

// Initialize database
setupDatabase().then(() => {
  console.log('Database setup completed successfully.');
}).catch((error) => {
  console.error('Failed to set up database:', error);
});

client.on('ready', async (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
  if (!readyHandled) {
    readyHandled = true;
    try {
      startScheduledTasks();
      console.log('Scheduled tasks started.');
      console.log("Current server time:", new Date().toLocaleString());
    } catch (error) {
      console.error('Failed to start scheduled tasks:', error);
    }
  } else {
    console.log('Ready event received again; scheduled tasks already initialized.');
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    const user = interaction.user.tag;
    const channelId = interaction.channelId;

    if (interaction.isAutocomplete()) {
      await handleAutocompleteInteraction(interaction);
      return;
    }

    if (interaction.isCommand()) {
      const commandName = interaction.commandName;
      console.log(`\n\n\nCommand received: ${commandName} from ${user} in channel ${channelId}`);
      const options = interaction.options.data.map(opt => `${opt.name}: ${opt.value}`).join(', ');
      console.log(`Options: ${options}`);

      if (!(await ensureElevatedCommandAccess(interaction, commandName))) {
        return;
      }

      // Fetch the member and log their roles
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const roles = member.roles.cache.map(role => role.name);
      console.log(`Roles for user ${user}: ${roles.join(', ')}`);  // Log the roles

      if (commandName === 'scrape') {
        await handleScrapeCommand(interaction);
      } else if (commandName === 'search') {
        await handleSearchCommand(interaction);
      } else if (commandName === 'savedsearch') {
        await handleSavedSearchCommand(interaction);
      } else if (commandName === 'dailysavedsearch') {
        await handleDailySavedSearchCommand(interaction);
      } else if (commandName === 'runtestscheduler') {
        await handleRunTestSchedulerCommand(interaction);
      } else if (commandName === 'commands') {
        await handleCommandsCommand(interaction);
      } else if (commandName === 'manualnotifynewvehicles') {
        await handleManualNotifyNewVehiclesCommand(interaction);
      } else if (commandName === 'testgitpushdb') {
        await handleRunTestGitPushDBCommand(interaction);
      }
    }

    if (interaction.isButton()) {
      const buttonId = interaction.customId;
      console.log(`Button clicked: ${buttonId} by ${user}`);
      await handleButtonClick(interaction, buttonId);
    }

  } catch (error) {
    console.error('Error processing interaction:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: 'An error occurred while processing your request.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN).catch((error) => {
  console.error('Failed to login:', error);
});
