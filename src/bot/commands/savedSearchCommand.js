const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSavedSearches, deleteSavedSearch, setSavedSearchFrequency } = require('../../database/savedSearchManager');
const { convertLocationToYardId, convertYardIdToLocation } = require('../utils/locationUtils');
const { queryVehicles } = require('../../database/vehicleQueryManager');

const SAVED_SEARCH_SESSION_MS = 2 * 60 * 1000;
const RESULTS_ITEMS_PER_PAGE = 20;
const ALL_YARD_IDS_CANONICAL = ['1020', '1021', '1022', '1099', '1119', '999999'];
const TREASURE_VALLEY_YARD_IDS_CANONICAL = ['1020', '1021', '1022', '1119', '999999'];
const SINGLE_YARD_LOCATION_BY_ID = {
  '1020': 'boise',
  '1021': 'caldwell',
  '1119': 'gardencity',
  '1022': 'nampa',
  '1099': 'twinfalls',
  '999999': 'trustypickapart',
};

function normalizeFrequency(frequency) {
  const normalized = String(frequency || 'daily').trim().toLowerCase();
  return normalized === 'paused' ? 'paused' : 'daily';
}

function normalizeYardIds(yardId) {
  if (yardId === null || yardId === undefined) {
    return [];
  }
  if (Array.isArray(yardId)) {
    return [...new Set(yardId.map((id) => String(id).trim()).filter((id) => id !== ''))].sort();
  }
  const raw = String(yardId).trim();
  if (raw === '') {
    return [];
  }
  return [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => id !== ''))].sort();
}

function areSameYardIdSets(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function inferSearchLocation(yardId) {
  const normalizedIds = normalizeYardIds(yardId);
  if (areSameYardIdSets(normalizedIds, ALL_YARD_IDS_CANONICAL)) {
    return 'all';
  }
  if (areSameYardIdSets(normalizedIds, TREASURE_VALLEY_YARD_IDS_CANONICAL)) {
    return 'treasurevalleyyards';
  }
  if (normalizedIds.length === 1 && SINGLE_YARD_LOCATION_BY_ID[normalizedIds[0]]) {
    return SINGLE_YARD_LOCATION_BY_ID[normalizedIds[0]];
  }
  return convertYardIdToLocation(yardId).toLowerCase().replace(/\s+/g, '');
}

function sortVehiclesForSearchView(rows) {
  return [...rows].sort((a, b) => {
    const firstSeenA = new Date(a.first_seen);
    const firstSeenB = new Date(b.first_seen);
    return firstSeenB - firstSeenA || String(a.vehicle_model || '').localeCompare(String(b.vehicle_model || ''));
  });
}

function formatSavedSearchDate(rawDate) {
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return parsed.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

function buildSavedSearchComponents(currentIndex, totalCount, currentSearch) {
  const isPaused = normalizeFrequency(currentSearch.frequency) === 'paused';
  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`prev:${currentIndex}`).setLabel('Prev Saved').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === 0),
      new ButtonBuilder().setCustomId(`next:${currentIndex}`).setLabel('Next Saved').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === totalCount - 1),
      new ButtonBuilder().setCustomId(`run:${currentIndex}`).setLabel('Run').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`delete:${currentIndex}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`pause:${currentIndex}`)
        .setLabel(isPaused ? 'Resume Alerts' : 'Pause Alerts')
        .setStyle(ButtonStyle.Secondary)
    );

  return [buttonRow];
}

function buildSearchResultsComponents(currentPage, totalPages, currentSearch, currentIndex) {
  const isPaused = normalizeFrequency(currentSearch.frequency) === 'paused';
  const noResults = totalPages === 0;

  const buttonRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId('rprev').setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(noResults || currentPage === 0),
      new ButtonBuilder().setCustomId('rnext').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(noResults || currentPage >= totalPages - 1),
      new ButtonBuilder().setCustomId(`back:${currentIndex}`).setLabel('Back To Saved').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`delete:${currentIndex}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`pause:${currentIndex}`)
        .setLabel(isPaused ? 'Resume Alerts' : 'Pause Alerts')
        .setStyle(ButtonStyle.Secondary)
    );

  return [buttonRow];
}

function buildSavedSearchEmbed(search, currentIndex, totalCount) {
  const createDate = formatSavedSearchDate(search.create_date);
  const lastUpdatedDate = formatSavedSearchDate(search.update_date);
  const alertsState = normalizeFrequency(search.frequency) === 'paused' ? 'Paused' : 'Active';

  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle(`Saved Search: ${search.make} ${search.model} (${search.year_range})`)
    .setDescription(
      `Yard: ${search.yard_name}\n` +
      `Status: ${search.status}\n` +
      `Alerts: ${alertsState}\n` +
      `Created: ${createDate}\n` +
      `Last Updated: ${lastUpdatedDate}`
    )
    .setFooter({ text: `Viewing ${currentIndex + 1} of ${totalCount}` });

  return embed;
}

function buildSearchResultsEmbed(search, location, vehicles, currentPage, totalPages) {
  const make = search.make || 'Any';
  const model = search.model || 'Any';
  const yearRange = search.year_range || 'Any';
  const status = search.status || 'ACTIVE';

  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle(`Database search results for ${location} ${make} ${model} (${yearRange}) ${status}`)
    .setTimestamp();

  if (vehicles.length === 0) {
    embed
      .setDescription('No Results Found.\n\nPlease double check your Model naming if you are certain it should be in the yard.\nRemember simpler is usually better :)')
      .setFooter({ text: 'Page 0 of 0' });
    return embed;
  }

  const safePage = Math.min(Math.max(currentPage, 0), totalPages - 1);
  const start = safePage * RESULTS_ITEMS_PER_PAGE;
  const end = start + RESULTS_ITEMS_PER_PAGE;
  const pageItems = vehicles.slice(start, end);

  embed.setFooter({ text: `Page ${safePage + 1} of ${totalPages}` });

  pageItems.forEach((vehicle) => {
    const firstSeen = new Date(vehicle.first_seen);
    const lastUpdated = new Date(vehicle.last_updated);
    const firstSeenFormatted = `${firstSeen.getMonth() + 1}/${firstSeen.getDate()}`;
    const lastUpdatedFormatted = `${lastUpdated.getMonth() + 1}/${lastUpdated.getDate()}`;

    let valueText = `Yard: ${vehicle.yard_name}, Row: ${vehicle.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`;
    if (vehicle.notes) {
      valueText += `\nNotes: ${vehicle.notes}`;
    }

    embed.addFields({
      name: `${vehicle.vehicle_make} ${vehicle.vehicle_model} (${vehicle.vehicle_year})`,
      value: valueText,
      inline: false,
    });
  });

  return embed;
}

async function handleSavedSearchCommand(interaction) {
  console.log('Saved search retrieval command received.');
  const userId = interaction.user.id;
  const location = interaction.options.getString('location');
  let yardId = location ? convertLocationToYardId(location) : null;
  console.log(`Retrieving saved searches for user ${userId} in location ${location || 'All'}`);

  try {
    await interaction.deferReply({ ephemeral: true });
    const savedSearches = await getSavedSearches(userId, yardId);
    console.log('Retrieved saved searches successfully.');

    if (savedSearches.length === 0) {
      await interaction.editReply({ content: 'You have no saved searches matching the criteria.' });
      return;
    }

    let currentIndex = 0;
    let resultsState = null;

    const buildSavedViewPayload = () => {
      const currentSearch = savedSearches[currentIndex];
      const embed = buildSavedSearchEmbed(currentSearch, currentIndex, savedSearches.length);
      const components = buildSavedSearchComponents(currentIndex, savedSearches.length, currentSearch);
      return { embeds: [embed], components };
    };

    const buildResultsViewPayload = () => {
      const currentSearch = savedSearches[currentIndex];
      const embed = buildSearchResultsEmbed(
        currentSearch,
        resultsState.location,
        resultsState.vehicles,
        resultsState.currentPage,
        resultsState.totalPages
      );
      const components = buildSearchResultsComponents(
        resultsState.currentPage,
        resultsState.totalPages,
        currentSearch,
        currentIndex
      );
      return { embeds: [embed], components };
    };

    const buildActiveViewPayload = () => (resultsState ? buildResultsViewPayload() : buildSavedViewPayload());

    await interaction.editReply(buildSavedViewPayload());

    const replyMessage = await interaction.fetchReply();
    const collector = replyMessage.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: SAVED_SEARCH_SESSION_MS,
    });

    collector.on('collect', async (i) => {
      try {
        const [action, rawIndex] = String(i.customId || '').split(':');
        const parsedIndex = Number.parseInt(rawIndex, 10);
        const requestedIndex = Number.isInteger(parsedIndex) ? parsedIndex : currentIndex;
        const baseIndex = Math.min(Math.max(requestedIndex, 0), savedSearches.length - 1);

        if (action === 'next') {
          resultsState = null;
          currentIndex = Math.min(baseIndex + 1, savedSearches.length - 1);
          await i.update(buildSavedViewPayload());
          return;
        }

        if (action === 'prev') {
          resultsState = null;
          currentIndex = Math.max(baseIndex - 1, 0);
          await i.update(buildSavedViewPayload());
          return;
        }

        if (action === 'run') {
          const currentSearch = savedSearches[baseIndex];
          const vehicles = await queryVehicles(
            currentSearch.yard_id,
            currentSearch.make || 'ANY',
            currentSearch.model || 'ANY',
            currentSearch.year_range || 'ANY',
            currentSearch.status || 'ACTIVE'
          );
          const sortedVehicles = sortVehiclesForSearchView(vehicles);
          const totalPages = Math.ceil(sortedVehicles.length / RESULTS_ITEMS_PER_PAGE);
          resultsState = {
            searchId: currentSearch.id,
            location: inferSearchLocation(currentSearch.yard_id),
            vehicles: sortedVehicles,
            currentPage: 0,
            totalPages,
          };
          currentIndex = baseIndex;
          await i.update(buildResultsViewPayload());
          return;
        }

        if (action === 'rnext') {
          if (!resultsState) {
            await i.reply({ content: 'No search results are currently active.', ephemeral: true });
            return;
          }
          if (resultsState.currentPage < resultsState.totalPages - 1) {
            resultsState.currentPage += 1;
          }
          await i.update(buildResultsViewPayload());
          return;
        }

        if (action === 'rprev') {
          if (!resultsState) {
            await i.reply({ content: 'No search results are currently active.', ephemeral: true });
            return;
          }
          if (resultsState.currentPage > 0) {
            resultsState.currentPage -= 1;
          }
          await i.update(buildResultsViewPayload());
          return;
        }

        if (action === 'back') {
          resultsState = null;
          currentIndex = baseIndex;
          await i.update(buildSavedViewPayload());
          return;
        }

        if (action === 'delete') {
          const currentSearch = savedSearches[baseIndex];
          await deleteSavedSearch(currentSearch.id);
          savedSearches.splice(baseIndex, 1);
          if (resultsState && resultsState.searchId === currentSearch.id) {
            resultsState = null;
          }

          if (savedSearches.length === 0) {
            await i.update({ content: 'All saved searches have been deleted.', embeds: [], components: [] });
            collector.stop('all_deleted');
            return;
          }

          currentIndex = Math.min(baseIndex, savedSearches.length - 1);
          await i.update(buildActiveViewPayload());
          return;
        }

        if (action === 'pause') {
          const currentSearch = savedSearches[baseIndex];
          const currentFrequency = normalizeFrequency(currentSearch.frequency);
          const nextFrequency = currentFrequency === 'paused' ? 'daily' : 'paused';
          await setSavedSearchFrequency(currentSearch.id, nextFrequency);
          currentSearch.frequency = nextFrequency;
          currentSearch.update_date = new Date().toISOString();
          currentIndex = baseIndex;
          await i.update(buildActiveViewPayload());
          return;
        }

        await i.reply({ content: 'Unknown action.', ephemeral: true });
      } catch (collectorError) {
        console.error('Saved search interaction failed:', collectorError);
        await i.reply({ content: 'Unable to process that saved-search action right now.', ephemeral: true });
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason !== 'all_deleted') {
        try {
          await interaction.editReply({ components: [] });
        } catch (editError) {
          console.error('Unable to disable saved-search carousel buttons:', editError);
        }
      }
    });

  } catch (error) {
    console.error('Error retrieving saved searches:', error);
    await interaction.editReply({ content: 'Failed to retrieve saved searches.' });
  }
}

module.exports = { handleSavedSearchCommand };
