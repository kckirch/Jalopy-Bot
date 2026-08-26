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
  await interaction.update(session.buildResultsViewPayload());
}

async function deleteSearch(interaction, collector, session, index, dependencies) {
  const currentSearch = session.getSearch(index);
  await dependencies.deleteSavedSearch(currentSearch.id);
  session.remove(index);

  if (session.isEmpty()) {
    await interaction.update({
      content: 'All saved searches have been deleted.',
      embeds: [],
      components: [],
    });
    collector.stop('all_deleted');
    return;
  }

  await interaction.update(session.buildActiveViewPayload());
}

async function toggleSearchFrequency(interaction, session, index, dependencies) {
  const currentSearch = session.getSearch(index);
  const nextFrequency = session.getNextFrequency(index);
  await dependencies.setSavedSearchFrequency(currentSearch.id, nextFrequency);
  session.updateFrequency(index, nextFrequency, new Date().toISOString());
  await interaction.update(session.buildActiveViewPayload());
}

async function handleSessionAction(
  interaction,
  collector,
  session,
  dependencies
) {
  const [action, rawIndex] = String(interaction.customId || '').split(':');
  const index = session.resolveIndex(rawIndex);

  switch (action) {
    case 'next':
      session.moveSaved(index, 1);
      await interaction.update(session.buildSavedViewPayload());
      return;
    case 'prev':
      session.moveSaved(index, -1);
      await interaction.update(session.buildSavedViewPayload());
      return;
    case 'run':
      await runSavedSearch(interaction, session, index, dependencies);
      return;
    case 'rnext':
    case 'rprev':
      if (!session.hasResults()) {
        await interaction.reply({
          content: 'No search results are currently active.',
          ephemeral: true,
        });
        return;
      }
      session.moveResultsPage(action === 'rnext' ? 1 : -1);
      await interaction.update(session.buildResultsViewPayload());
      return;
    case 'back':
      session.showSaved(index);
      await interaction.update(session.buildSavedViewPayload());
      return;
    case 'delete':
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
    default:
      await interaction.reply({ content: 'Unknown action.', ephemeral: true });
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

  collector.on('collect', async (componentInteraction) => {
    try {
      await handleSessionAction(
        componentInteraction,
        collector,
        session,
        dependencies
      );
    } catch (error) {
      console.error('Saved search interaction failed:', summarizeError(error));
      await componentInteraction.reply({
        content: 'Unable to process that saved-search action right now.',
        ephemeral: true,
      });
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'all_deleted') return;
    try {
      await interaction.editReply({ components: [] });
    } catch (error) {
      console.error(
        'Unable to disable saved-search carousel buttons:',
        summarizeError(error)
      );
    }
  });

  return collector;
}

module.exports = { startSavedSearchSession };
