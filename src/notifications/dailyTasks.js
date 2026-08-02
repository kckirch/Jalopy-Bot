const { EmbedBuilder } = require('discord.js');
const { client } = require('../bot/utils/client');
const { getAllSavedSearches } = require('../database/savedSearchManager');
const { queryVehicles } = require('../database/vehicleQueryManager');
const { summarizeError } = require('../utils/errorSummary');

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const MAX_EMBED_FIELDS = 25;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_PAYLOAD_SIZE = 6000;

function getNewVehiclesChannelId() {
  const channelId = String(process.env.NEW_VEHICLES_CHANNEL_ID || '').trim();
  if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) {
    console.error(
      'NEW_VEHICLES_CHANNEL_ID must be configured with a valid Discord channel ID.'
    );
    return null;
  }
  return channelId;
}

function buildSavedSearchTitle(search) {
  return `Daily Search Results for ${search.make} ${search.model} (${search.year_range}) at ${search.yard_name} with ${search.status} status`;
}

async function processDailySavedSearches() {
  try {
    const savedSearches = await getAllSavedSearches();
    for (const search of savedSearches) {
      try {
        const frequency = String(search.frequency || 'daily')
          .trim()
          .toLowerCase();
        if (frequency === 'paused') {
          continue;
        }

        const results = await queryVehicles(
          search.yard_id,
          search.make || 'ANY',
          search.model || 'ANY',
          search.year_range || 'ANY',
          search.status || 'ACTIVE'
        );
        if (results.length > 0) {
          const embeds = buildVehicleEmbeds(
            results,
            buildSavedSearchTitle(search)
          );
          await sendNotification(search.user_id, embeds);
        }
      } catch (error) {
        console.error(
          'Error processing saved search:',
          summarizeError(error)
        );
      }
    }

    await notifyNewVehicles();
  } catch (error) {
    console.error(
      'Error processing daily saved searches:',
      summarizeError(error)
    );
  }
}

async function notifyNewVehicles() {
  try {
    const channelId = getNewVehiclesChannelId();
    if (!channelId) {
      return;
    }

    const newVehicles = await queryVehicles('ALL', 'ANY', 'ANY', 'ANY', 'NEW');
    if (newVehicles.length > 0) {
      const embeds = buildVehicleEmbeds(
        newVehicles,
        'New Vehicles Added Today'
      );
      await sendChannelNotification(channelId, embeds);
    }
  } catch (error) {
    console.error('Error notifying new vehicles:', summarizeError(error));
  }
}

async function sendNotification(userId, embeds) {
  if (!client || !client.isReady()) {
    console.error('Discord client is not ready. Cannot send messages.');
    return;
  }

  try {
    const user = await client.users.fetch(userId);
    await sendEmbedChunks(user, embeds);
  } catch (error) {
    console.error(
      'Failed to fetch notification recipient:',
      summarizeError(error)
    );
    throw error;
  }
}

async function sendChannelNotification(channelId, embeds) {
  if (!client || !client.isReady()) {
    console.error('Discord client is not ready. Cannot send messages.');
    return;
  }

  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.error('Notification channel not found.');
    return;
  }

  await sendEmbedChunks(channel, embeds);
}

async function sendEmbedChunk(target, embeds) {
  try {
    await target.send({ embeds });
  } catch (error) {
    console.error('Failed to send notification:', summarizeError(error));
    throw error;
  }
}

async function sendEmbedChunks(target, embeds) {
  let currentPayloadSize = 0;
  let chunk = [];

  for (const embed of embeds) {
    const embedSize = JSON.stringify(embed).length;
    const chunkIsFull =
      chunk.length >= MAX_EMBEDS_PER_MESSAGE ||
      currentPayloadSize + embedSize > MAX_EMBED_PAYLOAD_SIZE;

    if (chunk.length > 0 && chunkIsFull) {
      await sendEmbedChunk(target, chunk);
      chunk = [];
      currentPayloadSize = 0;
    }

    chunk.push(embed);
    currentPayloadSize += embedSize;
  }

  if (chunk.length > 0) {
    await sendEmbedChunk(target, chunk);
  }
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
  processDailySavedSearches,
  notifyNewVehicles,
};
