const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { summarizeError } = require('../../utils/errorSummary');
const {
  storeInteractionParameters,
} = require('./interactionParameters');
const { serializeYardId } = require('./savedSearchCriteria');
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

function buildSearchComponents(searchState, criteria, userId) {
  try {
    const createCustomId = (action) => {
      const serializedYardId = serializeYardId(searchState.yardId);
      const parameters = [
        `pg:${searchState.currentPage}`,
        `act:${action}`,
        `uid:${userId}`,
        `lc:${searchState.location}`,
        `yd:${serializedYardId}`,
        `mk:${criteria.make}`,
        `md:${criteria.model}`,
        `yr:${criteria.yearRange}`,
        `st:${criteria.status}`,
      ].join('|');
      return storeInteractionParameters(parameters);
    };

    const pagingRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(createCustomId('previous'))
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(
          searchState.currentPage === 0 || searchState.vehicles.length === 0
        ),
      new ButtonBuilder()
        .setCustomId(createCustomId('next'))
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(
          searchState.vehicles.length === 0 ||
            searchState.currentPage >= searchState.totalPages - 1
        ),
      new ButtonBuilder()
        .setCustomId(createCustomId('save'))
        .setLabel('Save Search')
        .setStyle(ButtonStyle.Success)
    );

    const savedSearchActionsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(createCustomId('unsave'))
        .setLabel('Delete Saved')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(createCustomId('savedlist'))
        .setLabel('My Saved Searches')
        .setStyle(ButtonStyle.Secondary)
    );

    const locationRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(createCustomId('relocate'))
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
  } catch (error) {
    console.error('Error creating custom ID:', summarizeError(error));
    throw error;
  }
}

function buildSearchViewPayload(searchState, criteria, userId) {
  return {
    embeds: [buildSearchPage(searchState, criteria)],
    components: buildSearchComponents(searchState, criteria, userId),
  };
}

module.exports = { buildSearchViewPayload };
