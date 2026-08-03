const { summarizeError } = require('../utils/errorSummary');

const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_PAYLOAD_SIZE = 6000;

function isClientReady(client) {
  if (!client || !client.isReady()) {
    console.error('Discord client is not ready. Cannot send messages.');
    return false;
  }
  return true;
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

async function sendUserNotification(client, userId, embeds) {
  if (!isClientReady(client)) {
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

async function sendChannelNotification(client, channelId, embeds) {
  if (!isClientReady(client)) {
    return;
  }

  const channel = client.channels.cache.get(channelId);
  if (!channel) {
    console.error('Notification channel not found.');
    return;
  }

  await sendEmbedChunks(channel, embeds);
}

module.exports = {
  sendChannelNotification,
  sendUserNotification,
};
