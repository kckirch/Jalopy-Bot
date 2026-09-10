const { summarizeError } = require('../../utils/errorSummary');
const { handleSearchAction } = require('./searchInteractionActions');

const SEARCH_SESSION_MS = 2 * 60 * 1000;

async function handleSearchInteraction(interaction, session, dependencies) {
  if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith('search:')) {
    await interaction.reply({
      content: 'Invalid or expired interaction.',
      ephemeral: true,
    });
    return;
  }

  if (session.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: 'You do not have permission to perform this action.',
      ephemeral: true,
    });
    return;
  }

  const handled = await handleSearchAction(
    interaction,
    interaction.customId.slice('search:'.length),
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
    ownerId,
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
