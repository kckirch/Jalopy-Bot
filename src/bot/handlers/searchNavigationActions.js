const { buildSearchViewPayload } = require('../utils/searchInteractionView');
const { createSearchState } = require('./searchState');
const { normalizeSearchCriteria } = require('../utils/searchCriteria');
const { SEARCH_LOCATION_CHOICES } = require('../locationChoices');
const { getSearchGroup } = require('../../database/vehicleSearchGroups');

async function replaceSearch(interaction, session, criteria, location, dependencies) {
  await interaction.deferUpdate();
  const nextState = await createSearchState(location, criteria, dependencies);
  await interaction.editReply(buildSearchViewPayload(nextState, criteria));
  // Only the filters successfully shown to the user may be saved next.
  session.criteria = criteria;
  session.searchState = nextState;
}

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
  if (!selectedLocation || !SEARCH_LOCATION_CHOICES.some(({ value }) => value === selectedLocation)) {
    await interaction.reply({
      content: 'No valid location selected.',
      ephemeral: true,
    });
    return;
  }

  await replaceSearch(interaction, session, session.criteria, selectedLocation, dependencies);
}

async function handleModelSuggestionAction(interaction, session, dependencies) {
  const selectedModel = interaction.values?.[0];
  if (!session.searchState.suggestedModels.includes(selectedModel)) {
    await interaction.reply({ content: 'That model suggestion has expired. Run `/search` again.', ephemeral: true });
    return;
  }
  const nextCriteria = { ...session.criteria, model: selectedModel.toUpperCase() };
  await replaceSearch(interaction, session, nextCriteria, session.searchState.location, dependencies);
}

async function handleRefineAction(interaction, action, session, dependencies) {
  let criteria = { ...session.criteria };
  let location = session.searchState.location;
  const selected = interaction.values?.[0];
  if (action === 'make') {
    if (!session.searchState.suggestedMakes?.includes(selected)) {
      await interaction.reply({ content: 'That make suggestion has expired. Use Edit Search to try again.', ephemeral: true });
      return;
    }
    criteria.make = selected;
  } else if (action === 'group') {
    const group = session.searchState.groups?.find(({ value }) => value === selected);
    if (!group) {
      await interaction.reply({ content: 'That group is no longer available in this search. Choose a group from the current response.', ephemeral: true });
      return;
    }
    criteria.model = group.value;
    if (group.years) criteria.yearRange = group.years.join('-');
  } else if (action === 'any-year') {
    if (getSearchGroup(criteria.make, criteria.model)?.years) {
      await interaction.reply({ content: 'A generation has a year window. Choose a model family first to search outside it.', ephemeral: true });
      return;
    }
    criteria.yearRange = 'ANY';
  } else if (action === 'all-locations') {
    location = 'all';
  } else if (action === 'edit-submit') {
    criteria = normalizeSearchCriteria({
      make: interaction.fields.getTextInputValue('make').trim(),
      model: interaction.fields.getTextInputValue('model').trim(),
      yearRange: interaction.fields.getTextInputValue('year').trim(),
      status: interaction.fields.getTextInputValue('status').trim(),
    });
  }
  await replaceSearch(interaction, session, criteria, location, dependencies);
}

module.exports = {
  handlePagingAction,
  handleRelocateAction,
  handleModelSuggestionAction,
  handleRefineAction,
};
