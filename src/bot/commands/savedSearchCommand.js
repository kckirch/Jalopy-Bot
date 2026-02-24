const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSavedSearches, deleteSavedSearch, setSavedSearchFrequency } = require('../../database/savedSearchManager');
const { convertLocationToYardId } = require('../utils/locationUtils');
const { queryVehicles } = require('../../database/vehicleQueryManager');

const MATCH_PREVIEW_LIMIT = 5;
const SAVED_SEARCH_SESSION_MS = 2 * 60 * 1000;

function sortVehiclesByMostRecent(rows) {
  return [...rows].sort((a, b) => {
    const lastUpdatedA = new Date(a.last_updated);
    const lastUpdatedB = new Date(b.last_updated);
    return lastUpdatedB - lastUpdatedA;
  });
}

function buildMatchSummary(search, vehicles) {
  if (!vehicles || vehicles.length === 0) {
    return {
      fieldName: 'Current DB Matches',
      fieldValue: `No matches right now for ${search.make} ${search.model} (${search.year_range}) ${search.status}.`,
    };
  }

  const topRows = sortVehiclesByMostRecent(vehicles).slice(0, MATCH_PREVIEW_LIMIT);
  const lines = topRows.map((vehicle) =>
    `${vehicle.vehicle_year} ${vehicle.vehicle_make} ${vehicle.vehicle_model} | ${vehicle.yard_name} Row ${vehicle.row_number}`
  );
  const remaining = vehicles.length - topRows.length;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more`);
  }

  return {
    fieldName: `Current DB Matches (${vehicles.length})`,
    fieldValue: lines.join('\n').slice(0, 1024),
  };
}

function normalizeFrequency(frequency) {
  const normalized = String(frequency || 'daily').trim().toLowerCase();
  return normalized === 'paused' ? 'paused' : 'daily';
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

function buildSavedSearchEmbed(search, currentIndex, totalCount, matchSummary = null) {
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

  if (matchSummary && matchSummary.fieldName && matchSummary.fieldValue) {
    embed.addFields({
      name: matchSummary.fieldName,
      value: matchSummary.fieldValue,
    });
  }

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
    const matchSummariesById = new Map();

    const buildViewPayload = () => {
      const currentSearch = savedSearches[currentIndex];
      const matchSummary = matchSummariesById.get(currentSearch.id) || null;
      const embed = buildSavedSearchEmbed(currentSearch, currentIndex, savedSearches.length, matchSummary);
      const components = buildSavedSearchComponents(currentIndex, savedSearches.length, currentSearch);
      return { embeds: [embed], components };
    };

    await interaction.editReply(buildViewPayload());

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
          currentIndex = Math.min(baseIndex + 1, savedSearches.length - 1);
          await i.update(buildViewPayload());
          return;
        }

        if (action === 'prev') {
          currentIndex = Math.max(baseIndex - 1, 0);
          await i.update(buildViewPayload());
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
          matchSummariesById.set(currentSearch.id, buildMatchSummary(currentSearch, vehicles));
          currentIndex = baseIndex;
          await i.update(buildViewPayload());
          return;
        }

        if (action === 'delete') {
          const currentSearch = savedSearches[baseIndex];
          await deleteSavedSearch(currentSearch.id);
          savedSearches.splice(baseIndex, 1);
          matchSummariesById.delete(currentSearch.id);

          if (savedSearches.length === 0) {
            await i.update({ content: 'All saved searches have been deleted.', embeds: [], components: [] });
            collector.stop('all_deleted');
            return;
          }

          currentIndex = Math.min(baseIndex, savedSearches.length - 1);
          await i.update(buildViewPayload());
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
          await i.update(buildViewPayload());
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
