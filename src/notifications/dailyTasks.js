const { client } = require('../bot/utils/client');
const { getAllSavedSearches } = require('../database/savedSearchManager');
const { queryVehicles } = require('../database/vehicleQueryManager');
const { getSessionID } = require('../utils/sessionId');
const { summarizeError } = require('../utils/errorSummary');
const {
  sendChannelNotification,
  sendUserNotification,
} = require('./notificationDelivery');
const {
  buildDailyVehicleEmbeds,
  buildSavedSearchTitle,
  buildVehicleEmbeds,
  getDailyNotificationFooterPrefix,
} = require('./vehicleNotificationFormatter');

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function getNewVehiclesChannelId() {
  const channelId = String(process.env.NEW_VEHICLES_CHANNEL_ID || '').trim();
  if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) {
    throw new Error(
      'NEW_VEHICLES_CHANNEL_ID must be configured with a valid Discord channel ID.'
    );
  }
  return channelId;
}

async function processSavedSearch(search, summary) {
  const frequency = String(search.frequency || 'daily').trim().toLowerCase();
  if (frequency === 'paused') {
    summary.pausedSavedSearches += 1;
    return;
  }

  summary.processedSavedSearches += 1;
  const results = await queryVehicles(
    search.yard_id,
    search.make || 'ANY',
    search.model || 'ANY',
    search.year_range || 'ANY',
    search.status || 'ACTIVE'
  );
  if (results.length > 0) {
    const embeds = buildVehicleEmbeds(results, buildSavedSearchTitle(search));
    await sendUserNotification(client, search.user_id, embeds);
    summary.savedSearchNotificationsSent += 1;
  }
}

async function processDailySavedSearches({ sessionID = getSessionID() } = {}) {
  const channelSummary = await notifyNewVehicles({ sessionID });
  const summary = {
    ...channelSummary,
    processedSavedSearches: 0,
    pausedSavedSearches: 0,
    savedSearchNotificationsSent: 0,
    savedSearchFailures: 0,
  };
  const savedSearches = await getAllSavedSearches();

  for (const search of savedSearches) {
    try {
      await processSavedSearch(search, summary);
    } catch (error) {
      summary.savedSearchFailures += 1;
      console.error('Error processing saved search:', summarizeError(error));
    }
  }

  return summary;
}

async function notifyNewVehicles({ sessionID = getSessionID() } = {}) {
  const channelId = getNewVehiclesChannelId();
  const newVehicles = await queryVehicles('ALL', 'ANY', 'ANY', 'ANY', 'NEW');
  const embeds = buildDailyVehicleEmbeds(newVehicles, sessionID);
  const delivery = await sendChannelNotification(client, channelId, embeds, {
    dedupeFooterPrefix: getDailyNotificationFooterPrefix(sessionID),
  });

  return {
    newVehicleCount: newVehicles.length,
    channelEmbedsSent: delivery.embedsSent,
    channelEmbedsSkipped: delivery.skippedEmbeds,
    channelMessagesSent: delivery.messagesSent,
  };
}

module.exports = {
  processDailySavedSearches,
  notifyNewVehicles,
};
