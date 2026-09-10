const { summarizeError } = require('../../utils/errorSummary');
const {
  SavedSearchSession,
} = require('../utils/savedSearchSession');
const {
  sortVehiclesForSearchView,
} = require('../utils/vehicleSearchResults');

const SAVED_SEARCH_SESSION_MS = 2 * 60 * 1000;

async function runSavedSearch(interaction, session, index, dependencies) {
  const currentSearch = session.getSearch(index);
  const vehicles = await dependencies.queryVehicles(
    currentSearch.yard_id,
    currentSearch.make || 'ANY',
    currentSearch.model || 'ANY',
    currentSearch.year_range || 'ANY',
    currentSearch.status || 'ACTIVE'
  );
  const sortedVehicles = sortVehiclesForSearchView(vehicles);
  const normalizedModel = String(currentSearch.model || 'ANY').toUpperCase();
  const suggestedModels =
    sortedVehicles.length === 0 && normalizedModel !== 'ANY'
      ? await dependencies.getModelSuggestionsForNoResults(
          currentSearch.make || 'ANY',
          normalizedModel,
          currentSearch.yard_id,
          8
        )
      : [];

  session.activateResults(index, sortedVehicles, suggestedModels);
  await interaction.editReply(session.buildResultsViewPayload());
}

async function deleteSearch(interaction, collector, session, index, dependencies) {
  const currentSearch = session.getSearch(index);
  await dependencies.deleteSavedSearch(currentSearch.id);
  session.remove(index);

  if (session.isEmpty()) {
    await interaction.editReply({
      content: 'Alert removed. You have no saved alerts left. Use `/search` to create one.',
      embeds: [],
      components: [],
    });
    collector.stop('all_deleted');
    return;
  }

  await interaction.editReply({ ...session.buildActiveViewPayload(), content: 'Alert removed.' });
}

async function toggleSearchFrequency(interaction, session, index, dependencies) {
  const currentSearch = session.getSearch(index);
  const nextFrequency = session.getNextFrequency(index);
  await dependencies.setSavedSearchFrequency(currentSearch.id, nextFrequency);
  session.updateFrequency(index, nextFrequency, new Date().toISOString());
  await interaction.editReply({
    ...session.buildActiveViewPayload(),
    content: nextFrequency === 'paused' ? 'Alerts paused. Your saved filters are unchanged.' : 'Daily alerts resumed.',
  });
}

async function handleSessionAction(
  interaction,
  collector,
  session,
  dependencies,
  action,
  index
) {

  switch (action) {
    case 'next':
      session.moveSaved(index, 1);
      await interaction.editReply(session.buildSavedViewPayload());
      return;
    case 'prev':
      session.moveSaved(index, -1);
      await interaction.editReply(session.buildSavedViewPayload());
      return;
    case 'run':
      await runSavedSearch(interaction, session, index, dependencies);
      return;
    case 'rnext':
    case 'rprev':
      if (!session.hasResults()) {
        await interaction.followUp({
          content: 'No search results are currently active.',
          ephemeral: true,
        });
        return;
      }
      session.moveResultsPage(action === 'rnext' ? 1 : -1);
      await interaction.editReply(session.buildResultsViewPayload());
      return;
    case 'back':
      session.showSaved(index);
      await interaction.editReply(session.buildSavedViewPayload());
      return;
    case 'delete':
      await interaction.editReply(session.buildDeleteConfirmationPayload(index));
      return;
    case 'confirm-delete':
      await deleteSearch(
        interaction,
        collector,
        session,
        index,
        dependencies
      );
      return;
    case 'pause':
      await toggleSearchFrequency(interaction, session, index, dependencies);
      return;
    case 'test-dm':
      try {
        await interaction.user.send('JalopyBot DM test: messages can reach you right now. Your saved alerts and their settings have not changed.');
      } catch (error) {
        console.error('Saved alert DM test failed:', summarizeError(error));
        await interaction.followUp({ content: 'I could not send the test DM. Allow direct messages from server members and check that Jalopy Bot is not blocked, then try again. Your saved alerts are unchanged.', ephemeral: true });
        return;
      }
      await interaction.followUp({ content: 'Test DM sent. This checks delivery right now; it does not change your alerts.', ephemeral: true });
      return;
    default:
      await interaction.followUp({ content: 'Unknown action.', ephemeral: true });
  }
}

async function startSavedSearchSession(
  interaction,
  savedSearches,
  dependencies
) {
  const session = new SavedSearchSession(savedSearches);
  await interaction.editReply(session.buildSavedViewPayload());

  const replyMessage = await interaction.fetchReply();
  const collector = replyMessage.createMessageComponentCollector({
    filter: (componentInteraction) =>
      componentInteraction.user.id === interaction.user.id,
    time: SAVED_SEARCH_SESSION_MS,
  });

  let busy = false;
  let expired = false;
  async function clearExpiredControls() {
    try {
      await interaction.editReply({
        content: 'These controls have expired. Use `/savedsearch` to reopen. Your alerts keep their current settings.',
        components: [],
      });
    } catch (error) {
      console.error('Unable to disable saved-search carousel buttons:', summarizeError(error));
    }
  }
  let pendingDeleteId = null;
  collector.on('collect', async (componentInteraction) => {
    if (busy) {
      await componentInteraction.reply({ content: 'Still processing your previous action. Please wait a moment.', ephemeral: true })
        .catch((error) => console.error('Unable to reply to repeated saved-search action:', summarizeError(error)));
      return;
    }
    busy = true;
    try {
      await componentInteraction.deferUpdate();
      const [action, rawIndex, searchId] = String(componentInteraction.customId || '').split(':');
      const index = session.resolveIndex(rawIndex);
      if (session.isEmpty() || (rawIndex !== undefined && String(session.getSearch(index).id) !== searchId)) {
        await componentInteraction.followUp({ content: 'This alert view has changed. Reopen `/savedsearch` before making changes.', ephemeral: true });
        return;
      }
      if (action === 'confirm-delete' && pendingDeleteId !== searchId) {
        await componentInteraction.followUp({ content: 'Removal was cancelled or has expired. Select Delete again to confirm this alert.', ephemeral: true });
        return;
      }
      pendingDeleteId = action === 'delete' ? searchId : null;
      await handleSessionAction(
        componentInteraction,
        collector,
        session,
        dependencies,
        action,
        index
      );
    } catch (error) {
      console.error('Saved search interaction failed:', summarizeError(error));
      const reply = componentInteraction.deferred || componentInteraction.replied ? 'followUp' : 'reply';
      await componentInteraction[reply]({
        content: 'Unable to confirm that action. Reopen `/savedsearch` to check its current state before trying again.',
        ephemeral: true,
      }).catch((replyError) => console.error('Unable to report saved-search interaction failure:', summarizeError(replyError)));
    } finally {
      busy = false;
      if (expired) await clearExpiredControls();
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'all_deleted') return;
    expired = true;
    if (!busy) await clearExpiredControls();
  });

  return collector;
}

module.exports = { startSavedSearchSession };
