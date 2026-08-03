const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { YARDS } = require('../../config/yards');
const { convertYardIdToLocation } = require('./locationUtils');
const {
  buildSearchResultsEmbed,
  getSearchResultPageCount,
} = require('./vehicleSearchResults');

const ALL_YARD_IDS_CANONICAL = Object.freeze(
  YARDS.map((yard) => String(yard.id)).sort()
);
const TREASURE_VALLEY_YARD_IDS_CANONICAL = Object.freeze(
  YARDS.filter((yard) => yard.treasureValleyOrder !== null)
    .map((yard) => String(yard.id))
    .sort()
);
const SINGLE_YARD_LOCATION_BY_ID = Object.freeze(
  Object.fromEntries(YARDS.map((yard) => [String(yard.id), yard.slug]))
);

function normalizeFrequency(frequency) {
  const normalized = String(frequency || 'daily').trim().toLowerCase();
  return normalized === 'paused' ? 'paused' : 'daily';
}

function normalizeYardIds(yardId) {
  if (yardId === null || yardId === undefined) return [];
  const values = Array.isArray(yardId) ? yardId : String(yardId).split(',');
  return [
    ...new Set(
      values.map((id) => String(id).trim()).filter((id) => id !== '')
    ),
  ].sort();
}

function areSameYardIdSets(left, right) {
  return (
    left.length === right.length &&
    left.every((yardId, index) => yardId === right[index])
  );
}

function inferSearchLocation(yardId) {
  const normalizedIds = normalizeYardIds(yardId);
  if (areSameYardIdSets(normalizedIds, ALL_YARD_IDS_CANONICAL)) {
    return 'all';
  }
  if (
    areSameYardIdSets(normalizedIds, TREASURE_VALLEY_YARD_IDS_CANONICAL)
  ) {
    return 'treasurevalleyyards';
  }
  if (
    normalizedIds.length === 1 &&
    SINGLE_YARD_LOCATION_BY_ID[normalizedIds[0]]
  ) {
    return SINGLE_YARD_LOCATION_BY_ID[normalizedIds[0]];
  }
  return convertYardIdToLocation(yardId).toLowerCase().replace(/\s+/g, '');
}

function formatSavedSearchDate(rawDate) {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

function buildSavedSearchComponents(currentIndex, totalCount, currentSearch) {
  const isPaused = normalizeFrequency(currentSearch.frequency) === 'paused';
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`prev:${currentIndex}`)
        .setLabel('Prev Saved')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentIndex === 0),
      new ButtonBuilder()
        .setCustomId(`next:${currentIndex}`)
        .setLabel('Next Saved')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentIndex === totalCount - 1),
      new ButtonBuilder()
        .setCustomId(`run:${currentIndex}`)
        .setLabel('Run')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`delete:${currentIndex}`)
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`pause:${currentIndex}`)
        .setLabel(isPaused ? 'Resume Alerts' : 'Pause Alerts')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildSearchResultsComponents(
  currentPage,
  totalPages,
  currentSearch,
  currentIndex
) {
  const isPaused = normalizeFrequency(currentSearch.frequency) === 'paused';
  const noResults = totalPages === 0;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('rprev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(noResults || currentPage === 0),
      new ButtonBuilder()
        .setCustomId('rnext')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(noResults || currentPage >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId(`back:${currentIndex}`)
        .setLabel('Back To Saved')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`delete:${currentIndex}`)
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`pause:${currentIndex}`)
        .setLabel(isPaused ? 'Resume Alerts' : 'Pause Alerts')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildSavedSearchEmbed(search, currentIndex, totalCount) {
  const alertsState =
    normalizeFrequency(search.frequency) === 'paused' ? 'Paused' : 'Active';
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(
      `Saved Search: ${search.make} ${search.model} (${search.year_range})`
    )
    .setDescription(
      `Yard: ${search.yard_name}\n` +
        `Status: ${search.status}\n` +
        `Alerts: ${alertsState}\n` +
        `Created: ${formatSavedSearchDate(search.create_date)}\n` +
        `Last Updated: ${formatSavedSearchDate(search.update_date)}`
    )
    .setFooter({ text: `Viewing ${currentIndex + 1} of ${totalCount}` });
}

function createSavedSearchSession(initialSavedSearches) {
  const savedSearches = [...initialSavedSearches];
  let currentIndex = 0;
  let resultsState = null;

  const clampIndex = (index) =>
    Math.min(Math.max(index, 0), Math.max(savedSearches.length - 1, 0));

  const resolveIndex = (rawIndex) => {
    const parsedIndex = Number.parseInt(rawIndex, 10);
    return clampIndex(Number.isInteger(parsedIndex) ? parsedIndex : currentIndex);
  };

  const getSearch = (index = currentIndex) => savedSearches[clampIndex(index)];

  const showSaved = (index) => {
    resultsState = null;
    currentIndex = clampIndex(index);
  };

  const moveSaved = (index, offset) => {
    showSaved(clampIndex(index) + offset);
  };

  const activateResults = (index, vehicles, suggestedModels) => {
    currentIndex = clampIndex(index);
    const currentSearch = getSearch();
    resultsState = {
      searchId: currentSearch.id,
      location: inferSearchLocation(currentSearch.yard_id),
      vehicles,
      currentPage: 0,
      totalPages: getSearchResultPageCount(vehicles),
      suggestedModels,
    };
  };

  const moveResultsPage = (offset) => {
    if (!resultsState) return false;
    resultsState.currentPage = Math.min(
      Math.max(resultsState.currentPage + offset, 0),
      Math.max(resultsState.totalPages - 1, 0)
    );
    return true;
  };

  const remove = (index) => {
    const removalIndex = clampIndex(index);
    const [removedSearch] = savedSearches.splice(removalIndex, 1);
    if (resultsState && resultsState.searchId === removedSearch.id) {
      resultsState = null;
    }
    currentIndex = clampIndex(removalIndex);
    return removedSearch;
  };

  const getNextFrequency = (index) =>
    normalizeFrequency(getSearch(index).frequency) === 'paused'
      ? 'daily'
      : 'paused';

  const updateFrequency = (index, frequency, updateDate) => {
    const search = getSearch(index);
    search.frequency = frequency;
    search.update_date = updateDate;
    currentIndex = clampIndex(index);
  };

  const buildSavedViewPayload = () => {
    const currentSearch = getSearch();
    return {
      embeds: [
        buildSavedSearchEmbed(
          currentSearch,
          currentIndex,
          savedSearches.length
        ),
      ],
      components: buildSavedSearchComponents(
        currentIndex,
        savedSearches.length,
        currentSearch
      ),
    };
  };

  const buildResultsViewPayload = () => {
    const currentSearch = getSearch();
    return {
      embeds: [
        buildSearchResultsEmbed({
          location: resultsState.location,
          make: currentSearch.make || 'Any',
          model: currentSearch.model || 'Any',
          yearRange: currentSearch.year_range || 'Any',
          status: currentSearch.status || 'ACTIVE',
          vehicles: resultsState.vehicles,
          currentPage: resultsState.currentPage,
          totalPages: resultsState.totalPages,
          suggestedModels: resultsState.suggestedModels,
        }),
      ],
      components: buildSearchResultsComponents(
        resultsState.currentPage,
        resultsState.totalPages,
        currentSearch,
        currentIndex
      ),
    };
  };

  return Object.freeze({
    activateResults,
    buildActiveViewPayload: () =>
      resultsState ? buildResultsViewPayload() : buildSavedViewPayload(),
    buildResultsViewPayload,
    buildSavedViewPayload,
    getNextFrequency,
    getSearch,
    hasResults: () => resultsState !== null,
    isEmpty: () => savedSearches.length === 0,
    moveResultsPage,
    moveSaved,
    remove,
    resolveIndex,
    showSaved,
    updateFrequency,
  });
}

module.exports = { createSavedSearchSession };
