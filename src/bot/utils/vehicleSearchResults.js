const { EmbedBuilder } = require('discord.js');
const { describeSearchGroup } = require('../../database/vehicleSearchGroups');

const SEARCH_RESULTS_PER_PAGE = 20;

function sortVehiclesForSearchView(rows) {
  return [...rows].sort((left, right) => {
    const firstSeenLeft = new Date(left.first_seen);
    const firstSeenRight = new Date(right.first_seen);
    return (
      firstSeenRight - firstSeenLeft ||
      String(left.vehicle_model || '').localeCompare(
        String(right.vehicle_model || '')
      )
    );
  });
}

function getSearchResultPageCount(vehicles) {
  return Math.ceil(vehicles.length / SEARCH_RESULTS_PER_PAGE);
}

function buildSearchResultsEmbed({
  location,
  make,
  model,
  yearRange,
  status,
  vehicles,
  currentPage,
  totalPages,
  suggestedModels = [],
  knownModel = false,
}) {
  const groupNote = describeSearchGroup(make, model);
  const filters = [`Years: ${yearRange} · Location: ${location} · Status: ${status}`, groupNote].filter(Boolean).join('\n\n');
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${make || 'Any'} ${model}`.slice(0, 256))
    .setDescription(filters)
    .setTimestamp();

  if (vehicles.length === 0) {
    let description =
      `${filters}\n\nNo vehicles match these filters right now.\n` + (knownModel || groupNote
        ? 'This model or group is recognized. Try another location or year.'
        : 'Check the model spelling, year, and location.');
    if (Array.isArray(suggestedModels) && suggestedModels.length > 0) {
      description += `\n\nSuggested model names: ${suggestedModels
        .slice(0, 8)
        .join(', ')}`;
    }
    embed.setDescription(description).setFooter({ text: '0 matches' });
    return embed;
  }

  const safePage = Math.min(Math.max(currentPage, 0), totalPages - 1);
  const start = safePage * SEARCH_RESULTS_PER_PAGE;
  const pageItems = vehicles.slice(start, start + SEARCH_RESULTS_PER_PAGE);

  embed.setFooter({ text: `Page ${safePage + 1} of ${totalPages}` });

  for (const vehicle of pageItems) {
    const firstSeen = new Date(vehicle.first_seen);
    const lastUpdated = new Date(vehicle.last_updated);
    const firstSeenFormatted = firstSeen.toLocaleDateString('en-US');
    const lastUpdatedFormatted = lastUpdated.toLocaleDateString('en-US');

    let value = `Yard: ${vehicle.yard_name}, Row: ${vehicle.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`;
    if (vehicle.notes) {
      value += `\nNotes: ${vehicle.notes}`;
    }

    embed.addFields({
      name: `${vehicle.vehicle_make} ${vehicle.vehicle_model} (${vehicle.vehicle_year})`,
      value,
      inline: false,
    });
  }

  return embed;
}

module.exports = {
  SEARCH_RESULTS_PER_PAGE,
  buildSearchResultsEmbed,
  getSearchResultPageCount,
  sortVehiclesForSearchView,
};
