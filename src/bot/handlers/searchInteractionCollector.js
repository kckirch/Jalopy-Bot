const { summarizeError } = require('../../utils/errorSummary');
const { handleSearchAction } = require('./searchInteractionActions');
const { randomUUID } = require('node:crypto');
const { InteractionCollector, InteractionType } = require('discord.js');
const { buildSearchEditModal } = require('../utils/searchInteractionView');

const SEARCH_SESSION_MS = 2 * 60 * 1000;

async function openSearchEditModal(interaction, session, onSubmit) {
  const criteriaAtOpen = session.criteria;
  const stateAtOpen = session.searchState;
  const customId = `search:edit:${randomUUID()}`;
  const pending = new InteractionCollector(interaction.client, {
    interactionType: InteractionType.ModalSubmit,
    filter: (submission) => submission.customId === customId && submission.user.id === session.ownerId,
    time: 90_000,
    max: 1,
  });
  pending.on('collect', (submission) => onSubmit(submission, criteriaAtOpen, stateAtOpen));
  try {
    await interaction.showModal(buildSearchEditModal(session.criteria, customId));
  } catch (error) {
    pending.stop('failed');
    throw error;
  }
  return pending;
}

async function handleSearchInteraction(interaction, session, dependencies, actionOverride) {
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
    actionOverride || interaction.customId.slice('search:'.length),
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
  let modalCollector;

  async function openEditModal(interaction) {
    modalCollector?.stop('replaced');
    modalCollector = await openSearchEditModal(interaction, session, async (submission, criteriaAtOpen, stateAtOpen) => {
      if (expired || criteriaAtOpen !== session.criteria || stateAtOpen !== session.searchState) {
        await submission.reply({ content: 'This search changed or expired while you were editing. Reopen Edit Search or run `/search` again.', ephemeral: true })
          .catch((error) => console.error('Unable to report stale search edit:', summarizeError(error)));
        return;
      }
      await processInteraction(submission, 'edit-submit');
    });
  }
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
  async function processInteraction(interaction, actionOverride) {
    if (busy) {
      await interaction.reply({ content: 'Still processing your previous action. Please wait a moment.', ephemeral: true })
        .catch((error) => console.error('Unable to reply to repeated search action:', summarizeError(error)));
      return;
    }
    busy = true;
    try {
      if (interaction.customId === 'search:edit' && interaction.user.id === ownerId) {
        await openEditModal(interaction);
      } else {
        await handleSearchInteraction(interaction, session, dependencies, actionOverride);
      }
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
  }
  collector.on('collect', processInteraction);

  collector.on('end', async () => {
    expired = true;
    modalCollector?.stop('search-ended');
    // An in-flight update must finish before expiry removes its buttons.
    if (!busy) await clearExpiredControls();
  });

  return collector;
}

module.exports = { attachSearchInteractionCollector };
