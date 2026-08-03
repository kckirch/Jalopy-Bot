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

class SavedSearchSession {
  #savedSearches;
  #currentIndex;
  #resultsState;

  constructor(initialSavedSearches) {
    this.#savedSearches = [...initialSavedSearches];
    this.#currentIndex = 0;
    this.#resultsState = null;
  }

  #clampIndex(index) {
    return Math.min(
      Math.max(index, 0),
      Math.max(this.#savedSearches.length - 1, 0)
    );
  }

  resolveIndex(rawIndex) {
    const parsedIndex = Number.parseInt(rawIndex, 10);
    const fallbackIndex = Number.isInteger(parsedIndex)
      ? parsedIndex
      : this.#currentIndex;
    return this.#clampIndex(fallbackIndex);
  }

  getSearch(index = this.#currentIndex) {
    return this.#savedSearches[this.#clampIndex(index)];
  }

  showSaved(index) {
    this.#resultsState = null;
    this.#currentIndex = this.#clampIndex(index);
  }

  moveSaved(index, offset) {
    this.showSaved(this.#clampIndex(index) + offset);
  }

  activateResults(index, vehicles, suggestedModels) {
    this.#currentIndex = this.#clampIndex(index);
    const currentSearch = this.getSearch();
    this.#resultsState = {
      searchId: currentSearch.id,
      location: inferSearchLocation(currentSearch.yard_id),
      vehicles,
      currentPage: 0,
      totalPages: getSearchResultPageCount(vehicles),
      suggestedModels,
    };
  }

  moveResultsPage(offset) {
    if (!this.#resultsState) return false;
    this.#resultsState.currentPage = Math.min(
      Math.max(this.#resultsState.currentPage + offset, 0),
      Math.max(this.#resultsState.totalPages - 1, 0)
    );
    return true;
  }

  remove(index) {
    const removalIndex = this.#clampIndex(index);
    const [removedSearch] = this.#savedSearches.splice(removalIndex, 1);
    if (
      this.#resultsState &&
      this.#resultsState.searchId === removedSearch.id
    ) {
      this.#resultsState = null;
    }
    this.#currentIndex = this.#clampIndex(removalIndex);
    return removedSearch;
  }

  getNextFrequency(index) {
    return normalizeFrequency(this.getSearch(index).frequency) === 'paused'
      ? 'daily'
      : 'paused';
  }

  updateFrequency(index, frequency, updateDate) {
    const search = this.getSearch(index);
    search.frequency = frequency;
    search.update_date = updateDate;
    this.#currentIndex = this.#clampIndex(index);
  }

  buildSavedViewPayload() {
    const currentSearch = this.getSearch();
    return {
      embeds: [
        buildSavedSearchEmbed(
          currentSearch,
          this.#currentIndex,
          this.#savedSearches.length
        ),
      ],
      components: buildSavedSearchComponents(
        this.#currentIndex,
        this.#savedSearches.length,
        currentSearch
      ),
    };
  }

  buildResultsViewPayload() {
    const currentSearch = this.getSearch();
    return {
      embeds: [
        buildSearchResultsEmbed({
          location: this.#resultsState.location,
          make: currentSearch.make || 'Any',
          model: currentSearch.model || 'Any',
          yearRange: currentSearch.year_range || 'Any',
          status: currentSearch.status || 'ACTIVE',
          vehicles: this.#resultsState.vehicles,
          currentPage: this.#resultsState.currentPage,
          totalPages: this.#resultsState.totalPages,
          suggestedModels: this.#resultsState.suggestedModels,
        }),
      ],
      components: buildSearchResultsComponents(
        this.#resultsState.currentPage,
        this.#resultsState.totalPages,
        currentSearch,
        this.#currentIndex
      ),
    };
  }

  buildActiveViewPayload() {
    return this.#resultsState
      ? this.buildResultsViewPayload()
      : this.buildSavedViewPayload();
  }

  hasResults() {
    return this.#resultsState !== null;
  }

  isEmpty() {
    return this.#savedSearches.length === 0;
  }
}

function createSavedSearchSession(initialSavedSearches) {
  const session = new SavedSearchSession(initialSavedSearches);
  return Object.freeze({
    activateResults: session.activateResults.bind(session),
    buildActiveViewPayload: session.buildActiveViewPayload.bind(session),
    buildResultsViewPayload: session.buildResultsViewPayload.bind(session),
    buildSavedViewPayload: session.buildSavedViewPayload.bind(session),
    getNextFrequency: session.getNextFrequency.bind(session),
    getSearch: session.getSearch.bind(session),
    hasResults: session.hasResults.bind(session),
    isEmpty: session.isEmpty.bind(session),
    moveResultsPage: session.moveResultsPage.bind(session),
    moveSaved: session.moveSaved.bind(session),
    remove: session.remove.bind(session),
    resolveIndex: session.resolveIndex.bind(session),
    showSaved: session.showSaved.bind(session),
    updateFrequency: session.updateFrequency.bind(session),
  });
}

module.exports = { createSavedSearchSession };
