const { buildSearchViewPayload } = require('../utils/searchInteractionView');
const { createSearchState } = require('./searchState');

function getSearchViewPayload(session) {
  return buildSearchViewPayload(
    session.searchState,
    session.criteria
  );
}

async function handlePagingAction(interaction, action, session) {
  if (
    action === 'next' &&
    session.searchState.currentPage < session.searchState.totalPages - 1
  ) {
    session.searchState.currentPage += 1;
  }
  if (action === 'previous' && session.searchState.currentPage > 0) {
    session.searchState.currentPage -= 1;
  }

  await interaction.update(getSearchViewPayload(session));
}

async function handleRelocateAction(
  interaction,
  session,
  dependencies
) {
  const selectedLocation = Array.isArray(interaction.values)
    ? interaction.values[0]
    : null;
  if (!selectedLocation) {
    await interaction.reply({
      content: 'No location selected.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();
  const nextState = await createSearchState(
    selectedLocation,
    session.criteria,
    dependencies
  );
  await interaction.editReply(buildSearchViewPayload(nextState, session.criteria));
  session.searchState = nextState;
}

async function handleModelSuggestionAction(interaction, session, dependencies) {
  const selectedModel = interaction.values?.[0];
  if (!session.searchState.suggestedModels.includes(selectedModel)) {
    await interaction.reply({ content: 'That model suggestion has expired. Run `/search` again.', ephemeral: true });
    return;
  }
  await interaction.deferUpdate();
  const nextCriteria = { ...session.criteria, model: selectedModel.toUpperCase() };
  const nextState = await createSearchState(session.searchState.location, nextCriteria, dependencies);
  await interaction.editReply(buildSearchViewPayload(nextState, nextCriteria));
  session.criteria = nextCriteria;
  session.searchState = nextState;
}

module.exports = {
  handlePagingAction,
  handleRelocateAction,
  handleModelSuggestionAction,
};
