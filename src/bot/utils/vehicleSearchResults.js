const { EmbedBuilder } = require('discord.js');

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
}) {
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(
      `Database search results for ${location} ${make || 'Any'} ${model} (${yearRange}) ${status}`
    )
    .setTimestamp();

  if (vehicles.length === 0) {
    let description =
      'No Results Found.\n\nPlease double check your Model naming if you are certain it should be in the yard.\nRemember simpler is usually better :)';
    if (Array.isArray(suggestedModels) && suggestedModels.length > 0) {
      description += `\n\nPossible model names we have seen: ${suggestedModels
        .slice(0, 8)
        .join(', ')}`;
    }
    embed.setDescription(description).setFooter({ text: 'Page 0 of 0' });
    return embed;
  }

  const safePage = Math.min(Math.max(currentPage, 0), totalPages - 1);
  const start = safePage * SEARCH_RESULTS_PER_PAGE;
  const pageItems = vehicles.slice(start, start + SEARCH_RESULTS_PER_PAGE);

  embed.setFooter({ text: `Page ${safePage + 1} of ${totalPages}` });

  for (const vehicle of pageItems) {
    const firstSeen = new Date(vehicle.first_seen);
    const lastUpdated = new Date(vehicle.last_updated);
    const firstSeenFormatted = `${firstSeen.getMonth() + 1}/${firstSeen.getDate()}`;
    const lastUpdatedFormatted = `${lastUpdated.getMonth() + 1}/${lastUpdated.getDate()}`;

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
