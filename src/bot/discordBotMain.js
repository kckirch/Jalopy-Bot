require('dotenv').config({ path: '../.env' });

const { client } = require('./utils/client.js');
const { setupDatabase } = require('../database/database');
const { startScheduledTasks } = require('../notifications/scheduler');
const { handleButtonClick } = require('./handlers/buttonClickHandler');
const { getSessionID } = require('./utils/utils'); // Ensure getSessionID is imported

const { handleScrapeCommand } = require('./commands/scrapeCommand');
const { handleSearchCommand } = require('./commands/searchCommand');
const { handleSavedSearchCommand } = require('./commands/savedSearchCommand');
const { handleDailySavedSearchCommand } = require('./commands/dailySavedSearchCommand');
const { handleRunTestSchedulerCommand } = require('./commands/runTestSchedulerCommand');
const { handleCommandsCommand } = require('./commands/commandsCommand');
const { handleManualNotifyNewVehiclesCommand } = require('./commands/manualNotifyNewVehiclesCommand');
const { handleTestGitPushDBCommand } = require('./commands/testGitPushDBCommand');

// Initialize database
setupDatabase().then(() => {
  console.log('Database setup completed successfully.');
}).catch((error) => {
  console.error('Failed to set up database:', error);
});

client.on('ready', async (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
  try {
    startScheduledTasks();
    console.log('Scheduled tasks started.');
    console.log("Current server time:", new Date().toLocaleString());
  } catch (error) {
    console.error('Failed to start scheduled tasks:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    const user = interaction.user.tag;
    const channelId = interaction.channelId;

    if (interaction.isCommand()) {
      const commandName = interaction.commandName;
      console.log(`\n\n\nCommand received: ${commandName} from ${user} in channel ${channelId}`);
      const options = interaction.options.data.map(opt => `${opt.name}: ${opt.value}`).join(', ');
      console.log(`Options: ${options}`);

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
        await handleTestGitPushDBCommand(interaction);
      }
    }

    if (interaction.isButton()) {
      const buttonId = interaction.customId;
      console.log(`Button clicked: ${buttonId} by ${user}`);
      await handleButtonClick(interaction, buttonId);
    }

  } catch (error) {
    console.error('Error processing interaction:', error);
    await interaction.reply('An error occurred while processing your request.');
  }
});

client.login(process.env.TOKEN);
