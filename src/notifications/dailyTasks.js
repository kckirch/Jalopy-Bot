const { client } = require('../bot/utils/client');
const { getAllSavedSearches } = require('../database/savedSearchManager');
const { queryVehicles } = require('../database/vehicleQueryManager');
const { summarizeError } = require('../utils/errorSummary');
const {
  sendChannelNotification,
  sendUserNotification,
} = require('./notificationDelivery');
const {
  buildSavedSearchTitle,
  buildVehicleEmbeds,
} = require('./vehicleNotificationFormatter');

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

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
          await sendUserNotification(client, search.user_id, embeds);
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
      await sendChannelNotification(client, channelId, embeds);
    }
  } catch (error) {
    console.error('Error notifying new vehicles:', summarizeError(error));
  }
}

module.exports = {
  processDailySavedSearches,
  notifyNewVehicles,
};
