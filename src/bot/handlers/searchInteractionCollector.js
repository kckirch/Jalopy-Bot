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

  // ponytail: serialize clicks per message; cross-message dedup needs canonical DB uniqueness.
  let busy = false;
  let expired = false;
  async function clearExpiredControls() {
    try {
      await message.edit({
        content: 'These search controls have expired. Run `/search` again, or `/savedsearch` to manage alerts you saved.',
        components: [],
      });
    } catch (error) {
      console.error('Error clearing expired search components:', summarizeError(error));
    }
  }
  collector.on('collect', async (interaction) => {
    if (busy) {
      await interaction.reply({ content: 'Still processing your previous action. Please wait a moment.', ephemeral: true })
        .catch((error) => console.error('Unable to reply to repeated search action:', summarizeError(error)));
      return;
    }
    busy = true;
    try {
      await handleSearchInteraction(interaction, session, dependencies);
    } catch (error) {
      console.error(
        'Error processing button interaction:',
        summarizeError(error)
      );
      const reply = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
      await interaction[reply]({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      }).catch((replyError) => console.error('Unable to report search interaction failure:', summarizeError(replyError)));
    } finally {
      busy = false;
      if (expired) await clearExpiredControls();
    }
  });

  collector.on('end', async () => {
    expired = true;
    // An in-flight update must finish before expiry removes its buttons.
    if (!busy) await clearExpiredControls();
  });

  return collector;
}

module.exports = { attachSearchInteractionCollector };
