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

  session.searchState = await createSearchState(
    selectedLocation,
    session.criteria,
    dependencies
  );
  await interaction.update(getSearchViewPayload(session));
}

module.exports = {
  handlePagingAction,
  handleRelocateAction,
};
