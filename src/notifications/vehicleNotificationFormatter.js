const { EmbedBuilder } = require('discord.js');

const MAX_EMBED_FIELDS = 25;

function buildSavedSearchTitle(search) {
  return `Daily Search Results for ${search.make} ${search.model} (${search.year_range}) at ${search.yard_name} with ${search.status} status`;
}

function formatVehicleDate(value) {
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function buildVehicleField(vehicle) {
  const firstSeenFormatted = formatVehicleDate(vehicle.first_seen);
  const lastUpdatedFormatted = formatVehicleDate(vehicle.last_updated);
  let value =
    `Yard: ${vehicle.yard_name}, Row: ${vehicle.row_number}\n` +
    `First Seen: ${firstSeenFormatted}\n` +
    `Last Updated: ${lastUpdatedFormatted}`;

  if (vehicle.notes) {
    value += `\nNotes: ${vehicle.notes}`;
  }

  return {
    name: `${vehicle.vehicle_make} ${vehicle.vehicle_model} (${vehicle.vehicle_year})`,
    value,
    inline: false,
  };
}

function buildVehicleEmbeds(vehicles, title) {
  const embeds = [];

  for (let index = 0; index < vehicles.length; index += MAX_EMBED_FIELDS) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(`Results found: ${vehicles.length}`)
      .setColor(0x0099ff)
      .setTimestamp();

    vehicles
      .slice(index, index + MAX_EMBED_FIELDS)
      .forEach((vehicle) => embed.addFields(buildVehicleField(vehicle)));
    embeds.push(embed);
  }

  return embeds;
}

module.exports = {
  buildSavedSearchTitle,
  buildVehicleEmbeds,
};
