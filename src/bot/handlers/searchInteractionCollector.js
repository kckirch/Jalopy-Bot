const { summarizeError } = require('../../utils/errorSummary');
const {
  resolveInteractionParameters,
} = require('../utils/interactionParameters');
const { handleSearchAction } = require('./searchInteractionActions');

const SEARCH_SESSION_MS = 2 * 60 * 1000;

function parseInteractionParameters(customId) {
  const parameters = resolveInteractionParameters(customId);
  if (!parameters) {
    return null;
  }

  return parameters.split('|').reduce((parsed, part) => {
    const separatorIndex = part.indexOf(':');
    const key = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? '' : part.slice(separatorIndex + 1);
    parsed[key] = value;
    return parsed;
  }, {});
}

async function handleSearchInteraction(interaction, session, dependencies) {
  const parts = parseInteractionParameters(interaction.customId);
  if (!parts) {
    await interaction.reply({
      content: 'Invalid or expired interaction.',
      ephemeral: true,
    });
    return;
  }

  const userId = parts.uid;
  if (userId !== interaction.user.id) {
    await interaction.reply({
      content: 'You do not have permission to perform this action.',
      ephemeral: true,
    });
    return;
  }

  const handled = await handleSearchAction(
    interaction,
    parts.act,
    userId,
    session,
    dependencies
  );
  if (!handled) {
    await interaction.reply({
      content: 'Unsupported action.',
      ephemeral: true,
    });
  }
}

function attachSearchInteractionCollector(
  { message, ownerId, initialSearchState, criteria },
  dependencies
) {
  const session = {
    searchState: initialSearchState,
    criteria,
  };
  const collector = message.createMessageComponentCollector({
    filter: (interaction) => interaction.user.id === ownerId,
    time: SEARCH_SESSION_MS,
  });

  collector.on('collect', async (interaction) => {
    try {
      await handleSearchInteraction(interaction, session, dependencies);
    } catch (error) {
      console.error(
        'Error processing button interaction:',
        summarizeError(error)
      );
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  });

  collector.on('end', async () => {
    try {
      await message.edit({ components: [] });
    } catch (error) {
      console.error(
        'Error clearing expired search components:',
        summarizeError(error)
      );
    }
  });

  return collector;
}

module.exports = { attachSearchInteractionCollector };
