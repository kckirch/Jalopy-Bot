const { summarizeError } = require('../utils/errorSummary');

const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_EMBED_PAYLOAD_SIZE = 6000;

function isClientReady(client) {
  if (
    !client ||
    typeof client.isReady !== 'function' ||
    !client.isReady()
  ) {
    throw new Error('Discord client is not ready. Cannot send messages.');
  }
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
  let messagesSent = 0;

  for (const embed of embeds) {
    const embedSize = JSON.stringify(embed).length;
    const chunkIsFull =
      chunk.length >= MAX_EMBEDS_PER_MESSAGE ||
      currentPayloadSize + embedSize > MAX_EMBED_PAYLOAD_SIZE;

    if (chunk.length > 0 && chunkIsFull) {
      await sendEmbedChunk(target, chunk);
      messagesSent += 1;
      chunk = [];
      currentPayloadSize = 0;
    }

    chunk.push(embed);
    currentPayloadSize += embedSize;
  }

  if (chunk.length > 0) {
    await sendEmbedChunk(target, chunk);
    messagesSent += 1;
  }

  return messagesSent;
}

async function sendUserNotification(client, userId, embeds) {
  isClientReady(client);

  try {
    const user = await client.users.fetch(userId);
    const messagesSent = await sendEmbedChunks(user, embeds);
    return { embedsSent: embeds.length, messagesSent, skippedEmbeds: 0 };
  } catch (error) {
    console.error(
      'Failed to deliver user notification:',
      summarizeError(error)
    );
    throw error;
  }
}

async function resolveNotificationChannel(client, channelId) {
  const cachedChannel = client.channels?.cache?.get?.(channelId);
  if (cachedChannel) return cachedChannel;

  if (typeof client.channels?.fetch !== 'function') {
    throw new Error('Notification channel not found.');
  }
  const fetchedChannel = await client.channels.fetch(channelId);
  if (!fetchedChannel) {
    throw new Error('Notification channel not found.');
  }
  return fetchedChannel;
}

function getEmbedFooterText(embed) {
  if (typeof embed?.footer?.text === 'string') return embed.footer.text;
  if (typeof embed?.data?.footer?.text === 'string') return embed.data.footer.text;
  if (typeof embed?.toJSON === 'function') return embed.toJSON().footer?.text || '';
  return '';
}

function listMessages(messages) {
  if (Array.isArray(messages)) return messages;
  if (messages && typeof messages.values === 'function') {
    return [...messages.values()];
  }
  return [];
}

async function removePreviouslySentEmbeds(channel, embeds, footerPrefix) {
  if (!footerPrefix) return { embeds, skippedEmbeds: 0 };
  if (!channel.messages || typeof channel.messages.fetch !== 'function') {
    throw new Error('Notification channel cannot verify prior daily messages.');
  }

  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const sentFooters = new Set(
    listMessages(recentMessages)
      .flatMap((message) => message.embeds || [])
      .map(getEmbedFooterText)
      .filter((footer) => footer.startsWith(footerPrefix))
  );
  const pendingEmbeds = embeds.filter(
    (embed) => !sentFooters.has(getEmbedFooterText(embed))
  );
  return {
    embeds: pendingEmbeds,
    skippedEmbeds: embeds.length - pendingEmbeds.length,
  };
}

async function sendChannelNotification(client, channelId, embeds, options = {}) {
  isClientReady(client);
  const channel = await resolveNotificationChannel(client, channelId);
  if (typeof channel.send !== 'function') {
    throw new Error('Notification channel cannot receive messages.');
  }

  const pending = await removePreviouslySentEmbeds(
    channel,
    embeds,
    options.dedupeFooterPrefix
  );
  const messagesSent = await sendEmbedChunks(channel, pending.embeds);

  return {
    embedsSent: pending.embeds.length,
    messagesSent,
    skippedEmbeds: pending.skippedEmbeds,
  };
}

module.exports = {
  sendChannelNotification,
  sendUserNotification,
};
