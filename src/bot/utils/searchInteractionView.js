const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { buildSearchResultsEmbed } = require('./vehicleSearchResults');
const { SEARCH_LOCATION_CHOICES } = require('../locationChoices');

function buildSearchPage(searchState, criteria) {
  return buildSearchResultsEmbed({
    location: searchState.location,
    make: criteria.make,
    model: criteria.model,
    yearRange: criteria.yearRange,
    status: criteria.status,
    vehicles: searchState.vehicles,
    currentPage: searchState.currentPage,
    totalPages: searchState.totalPages,
    suggestedModels: searchState.suggestedModels,
  });
}

function buildSearchComponents(searchState) {
  const pagingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('search:previous')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(
        searchState.currentPage === 0 || searchState.vehicles.length === 0
      ),
    new ButtonBuilder()
      .setCustomId('search:next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(
        searchState.vehicles.length === 0 ||
          searchState.currentPage >= searchState.totalPages - 1
      ),
    new ButtonBuilder()
      .setCustomId('search:save')
      .setLabel('Save Search')
      .setStyle(ButtonStyle.Success)
  );

  const savedSearchActionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('search:unsave')
      .setLabel('Delete Saved')
      .setStyle(ButtonStyle.Danger)
  );

  const locationRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('search:relocate')
      .setPlaceholder('Run this search in another location')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        SEARCH_LOCATION_CHOICES.map((option) => ({
          label: option.name,
          value: option.value,
          default: option.value === searchState.location,
        }))
      )
  );

  return [pagingRow, savedSearchActionsRow, locationRow];
}

function buildSearchViewPayload(searchState, criteria) {
  return {
    embeds: [buildSearchPage(searchState, criteria)],
    components: buildSearchComponents(searchState),
  };
}

module.exports = { buildSearchViewPayload };
