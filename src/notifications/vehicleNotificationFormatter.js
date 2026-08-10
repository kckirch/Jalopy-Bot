const crypto = require('node:crypto');
const { EmbedBuilder } = require('discord.js');

const MAX_EMBED_FIELDS = 25;
const DAILY_NOTIFICATION_TITLE = 'New Vehicles Added Today';

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

function getDailyNotificationFooterPrefix(sessionID) {
  return `Daily inventory ${sessionID}`;
}

function applyDailyFooters(embeds, sessionID) {
  const footerPrefix = getDailyNotificationFooterPrefix(sessionID);
  return embeds.map((embed, index) => {
    const fields = embed.toJSON().fields || [];
    const contentId = crypto
      .createHash('sha256')
      .update(JSON.stringify(fields))
      .digest('hex')
      .slice(0, 12);
    return embed.setFooter({
      text: `${footerPrefix} • part ${index + 1} of ${embeds.length} • ${contentId}`,
    });
  });
}

function getDailyVehicleSortKey(vehicle) {
  return [
    vehicle.id,
    vehicle.yard_id,
    vehicle.yard_name,
    vehicle.row_number,
    vehicle.vehicle_make,
    vehicle.vehicle_model,
    vehicle.vehicle_year,
  ].map((value) => String(value ?? '')).join('|');
}

function buildDailyVehicleEmbeds(vehicles, sessionID) {
  if (vehicles.length > 0) {
    const sortedVehicles = [...vehicles].sort((left, right) =>
      getDailyVehicleSortKey(left).localeCompare(getDailyVehicleSortKey(right))
    );
    return applyDailyFooters(
      buildVehicleEmbeds(sortedVehicles, DAILY_NOTIFICATION_TITLE),
      sessionID
    );
  }

  return [
    new EmbedBuilder()
      .setTitle('Daily Inventory Update')
      .setDescription(
        'The inventory scrape completed successfully. No new vehicles were added today.'
      )
      .setColor(0x0099ff)
      .setTimestamp()
      .setFooter({
        text: `${getDailyNotificationFooterPrefix(sessionID)} • part 1 of 1`,
      }),
  ];
}

module.exports = {
  buildDailyVehicleEmbeds,
  buildSavedSearchTitle,
  buildVehicleEmbeds,
  getDailyNotificationFooterPrefix,
};
