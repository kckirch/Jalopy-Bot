const { client } = require('../bot/utils/client');
const { getAllSavedSearches } = require('../database/savedSearchManager');
const { queryVehicles } = require('../database/vehicleQueryManager');
const { EmbedBuilder } = require('discord.js');

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function getNewVehiclesChannelId() {
    const channelId = String(process.env.NEW_VEHICLES_CHANNEL_ID || '').trim();
    if (!DISCORD_SNOWFLAKE_PATTERN.test(channelId)) {
        console.error('NEW_VEHICLES_CHANNEL_ID must be configured with a valid Discord channel ID.');
        return null;
    }
    return channelId;
}

async function processDailySavedSearches() {
    try {
        const savedSearches = await getAllSavedSearches();
        for (const search of savedSearches) {
            try {
                const frequency = String(search.frequency || 'daily').trim().toLowerCase();
                if (frequency === 'paused') {
                    continue;
                }

                const results = await queryVehicles(search.yard_id, search.make || 'ANY', search.model || 'ANY', search.year_range || 'ANY', search.status || 'ACTIVE');
                if (results.length > 0) {
                    const embeds = formatMessages(results, search);
                    await sendNotification(search.user_id, embeds);
                }
            } catch (error) {
                console.error('Error processing saved search:', error);
            }
        }

        await notifyNewVehicles();

    } catch (error) {
        console.error('Error processing daily saved searches:', error);
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
            const embeds = formatVehicles(newVehicles, 'New Vehicles Added Today');
            await sendChannelNotification(channelId, embeds);
        }
    } catch (error) {
        console.error('Error notifying new vehicles:', error);
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
    } catch (err) {
        console.error('Failed to fetch notification recipient:', err);
        throw err;
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

async function sendEmbedChunks(target, embeds) {
    const maxEmbedSize = 6000; // Maximum size for embeds
    let currentEmbedSize = 0;
    let chunk = [];

    for (const embed of embeds) {
        const embedSize = JSON.stringify(embed).length;
        if (currentEmbedSize + embedSize > maxEmbedSize) {
            try {
                await target.send({ embeds: chunk });
            } catch (err) {
                console.error('Failed to send notification:', err);
                throw err;
            }
            chunk = [embed];
            currentEmbedSize = embedSize;
        } else {
            chunk.push(embed);
            currentEmbedSize += embedSize;
        }
    }

    if (chunk.length > 0) {
        try {
            await target.send({ embeds: chunk });
        } catch (err) {
            console.error('Failed to send notification:', err);
            throw err;
        }
    }
}

function formatMessages(vehicles, search) {
    let embeds = [];
    const chunkSize = 25; // Maximum fields per embed

    for (let i = 0; i < vehicles.length; i += chunkSize) {
        const embed = new EmbedBuilder()
            .setTitle(`Daily Search Results for ${search.make} ${search.model} (${search.year_range}) at ${search.yard_name} with ${search.status} status`)
            .setDescription(`Results found: ${vehicles.length}`)
            .setColor(0x0099FF) // Blue color
            .setTimestamp();

        vehicles.slice(i, i + chunkSize).forEach(vehicle => {
            const firstSeenFormatted = new Date(vehicle.first_seen).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const lastUpdatedFormatted = new Date(vehicle.last_updated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            let valueText = `Yard: ${vehicle.yard_name}, Row: ${vehicle.row_number}\nFirst Seen: ${firstSeenFormatted}\nLast Updated: ${lastUpdatedFormatted}`;
            if (vehicle.notes) {
                valueText += `\nNotes: ${vehicle.notes}`; // Add notes to the value text if present
            }

            embed.addFields({
                name: `${vehicle.vehicle_make} ${vehicle.vehicle_model} (${vehicle.vehicle_year})`,
                value: valueText,
                inline: false
            });
        });

        embeds.push(embed);
    }

    return embeds;
}

function formatVehicles(vehicles, title) {
    let embeds = [];
    const chunkSize = 25; // Maximum fields per embed

    for (let i = 0; i < vehicles.length; i += chunkSize) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`Results found: ${vehicles.length}`)
            .setColor(0x0099FF) // Blue color
            .setTimestamp();

        vehicles.slice(i, i + chunkSize).forEach(vehicle => {
            const firstSeenFormatted = new Date(vehicle.first_seen).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const lastUpdatedFormatted = new Date(vehicle.last_updated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            let valueText = `Yard: ${vehicle.yard_name}, Row: ${vehicle.row_number}\nFirst Seen: ${firstSeenFormatted}\nLast Updated: ${lastUpdatedFormatted}`;
            if (vehicle.notes) {
                valueText += `\nNotes: ${vehicle.notes}`; // Add notes to the value text if present
            }

            embed.addFields({
                name: `${vehicle.vehicle_make} ${vehicle.vehicle_model} (${vehicle.vehicle_year})`,
                value: valueText,
                inline: false
            });
        });

        embeds.push(embed);
    }

    return embeds;
}

module.exports = { processDailySavedSearches, notifyNewVehicles };
