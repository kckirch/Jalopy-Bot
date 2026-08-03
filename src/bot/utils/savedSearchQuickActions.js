const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const { convertYardIdToLocation } = require('./locationUtils');
const { buildQuickActionCustomId } = require('./interactionParameters');
const {
  canonicalizeYardIdForSavedSearch,
} = require('./savedSearchCriteria');

const SAVED_SEARCH_DM_PREVIEW_LIMIT = 15;

function normalizeLocationName(location, yardId) {
  if (location && location.trim() !== '') {
    return location;
  }
  return convertYardIdToLocation(yardId).replace(/\s{2,}/g, ' ').trim();
}

function buildQuickActionButtons(payload) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('delete', payload))
      .setLabel('Delete This Search')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('view', payload))
      .setLabel('See Saved')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('next', payload))
      .setLabel('Next Saved')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('run', payload))
      .setLabel('Run This Search')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('close', payload))
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createQuickActionPayload({
  userId,
  location,
  yardId,
  make,
  model,
  yearRange,
  status,
  savedSearchId,
  savedIndex = 0,
}) {
  const canonicalYardId = canonicalizeYardIdForSavedSearch(yardId);
  return {
    uid: userId,
    lc: normalizeLocationName(location, canonicalYardId),
    yd: canonicalYardId,
    mk: make,
    md: model,
    yr: yearRange,
    st: status,
    sid: savedSearchId || '',
    idx: Number.isInteger(savedIndex) && savedIndex >= 0 ? savedIndex : 0,
  };
}

function buildSavedSearchActionEmbed({
  title,
  message,
  payload,
  savedCount,
  selectedPosition = null,
}) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(message)
    .addFields(
      { name: 'Location', value: payload.lc || 'Any', inline: true },
      { name: 'Make', value: payload.mk || 'ANY', inline: true },
      { name: 'Model', value: payload.md || 'ANY', inline: true },
      { name: 'Year', value: payload.yr || 'ANY', inline: true },
      { name: 'Status', value: payload.st || 'ACTIVE', inline: true }
    );

  if (Number.isInteger(savedCount)) {
    const positionText = Number.isInteger(selectedPosition)
      ? ` (showing ${selectedPosition} of ${savedCount})`
      : '';
    embed.addFields({
      name: 'Saved Searches',
      value: `${savedCount}${positionText}`,
      inline: true,
    });
  }

  return embed;
}

function buildRunNowEmbed(payload, vehicles) {
  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('Run This Search')
    .setDescription(`Current match count: **${vehicles.length}**`)
    .addFields(
      { name: 'Location', value: payload.lc || 'Any', inline: true },
      { name: 'Make', value: payload.mk || 'ANY', inline: true },
      { name: 'Model', value: payload.md || 'ANY', inline: true },
      { name: 'Year', value: payload.yr || 'ANY', inline: true },
      { name: 'Status', value: payload.st || 'ACTIVE', inline: true }
    );

  const previewRows = vehicles.slice(0, 5);
  if (previewRows.length > 0) {
    const preview = previewRows
      .map((vehicle) =>
        `${vehicle.vehicle_year} ${vehicle.vehicle_make} ${vehicle.vehicle_model} | ${vehicle.yard_name} Row ${vehicle.row_number}`
      )
      .join('\n')
      .slice(0, 1024);
    embed.addFields({ name: 'Top Matches', value: preview });
  } else {
    embed.addFields({ name: 'Top Matches', value: 'No active matches right now.' });
  }

  if (vehicles.length > previewRows.length) {
    embed.setFooter({
      text: `Showing ${previewRows.length} of ${vehicles.length} matches`,
    });
  }

  return embed;
}

function buildSavedSearchActionMessage({
  userId,
  location,
  yardId,
  make,
  model,
  yearRange,
  status,
  savedSearchId = '',
  savedIndex = 0,
  savedSearches = [],
  title,
  message,
}) {
  const payload = createQuickActionPayload({
    userId,
    location,
    yardId,
    make,
    model,
    yearRange,
    status,
    savedSearchId,
    savedIndex,
  });

  const selectedPosition = savedSearches.length > 0 ? payload.idx + 1 : null;
  const embed = buildSavedSearchActionEmbed({
    title,
    message,
    payload,
    savedCount: savedSearches.length,
    selectedPosition,
  });

  return {
    embeds: [embed],
    components: [buildQuickActionButtons(payload)],
    ephemeral: true,
  };
}

function formatSavedSearchPreview(savedSearches) {
  const previewRows = savedSearches.slice(0, SAVED_SEARCH_DM_PREVIEW_LIMIT);
  const lines = previewRows.map((search) =>
    `- ${search.yard_name} | ${search.make} ${search.model} (${search.year_range}) | ${search.status}`
  );

  if (savedSearches.length > SAVED_SEARCH_DM_PREVIEW_LIMIT) {
    lines.push(
      `- ...and ${savedSearches.length - SAVED_SEARCH_DM_PREVIEW_LIMIT} more`
    );
  }

  return lines.join('\n');
}

module.exports = {
  buildQuickActionButtons,
  buildRunNowEmbed,
  buildSavedSearchActionEmbed,
  buildSavedSearchActionMessage,
  createQuickActionPayload,
  formatSavedSearchPreview,
  normalizeLocationName,
};
