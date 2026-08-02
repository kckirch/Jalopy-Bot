const { handleAutocompleteInteraction } = require('./autocompleteHandler');
const { handleButtonClick } = require('./buttonClickHandler');
const { handleCommandsCommand } = require('../commands/commandsCommand');
const { handleDailySavedSearchCommand } = require('../commands/dailySavedSearchCommand');
const { handleManualNotifyNewVehiclesCommand } = require('../commands/manualNotifyNewVehiclesCommand');
const { handleRunTestSchedulerCommand } = require('../commands/runTestSchedulerCommand');
const { handleSavedSearchCommand } = require('../commands/savedSearchCommand');
const { handleScrapeCommand } = require('../commands/scrapeCommand');
const { handleSearchCommand } = require('../commands/searchCommand');
const { ensureElevatedCommandAccess } = require('../utils/commandPermissions');

const DEFAULT_COMMAND_HANDLERS = Object.freeze({
  commands: handleCommandsCommand,
  dailysavedsearch: handleDailySavedSearchCommand,
  manualnotifynewvehicles: handleManualNotifyNewVehiclesCommand,
  runtestscheduler: handleRunTestSchedulerCommand,
  savedsearch: handleSavedSearchCommand,
  scrape: handleScrapeCommand,
  search: handleSearchCommand,
});

function describeUser(interaction) {
  return interaction.user?.tag || interaction.user?.id || 'unknown user';
}

function describeCommandOptions(interaction) {
  const options = Array.isArray(interaction.options?.data)
    ? interaction.options.data
    : [];

  return options
    .map((option) => `${option.name}: ${option.value}`)
    .join(', ');
}

function createInteractionHandler({
  commandHandlers = DEFAULT_COMMAND_HANDLERS,
  ensureCommandAccess = ensureElevatedCommandAccess,
  handleAutocomplete = handleAutocompleteInteraction,
  handleButton = handleButtonClick,
  logger = console,
} = {}) {
  return async function handleInteraction(interaction) {
    try {
      const user = describeUser(interaction);

      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
      }

      if (interaction.isCommand()) {
        const commandName = interaction.commandName;
        logger.log(
          `\n\n\nCommand received: ${commandName} from ${user} in channel ${interaction.channelId}`
        );
        logger.log(`Options: ${describeCommandOptions(interaction)}`);

        if (!(await ensureCommandAccess(interaction, commandName))) {
          return;
        }

        const commandHandler = commandHandlers[commandName];
        if (commandHandler) {
          await commandHandler(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        const buttonId = interaction.customId;
        logger.log(`Button clicked: ${buttonId} by ${user}`);
        await handleButton(interaction, buttonId);
      }
    } catch (error) {
      logger.error('Error processing interaction:', error);
      const errorMessage = {
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  };
}

const handleInteraction = createInteractionHandler();

module.exports = {
  createInteractionHandler,
  handleInteraction,
};
