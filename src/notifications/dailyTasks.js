const { client } = require('../bot/utils/client');
const { getAllSavedSearches } = require('../database/savedSearchManager');
const { queryVehicles, executeQuery } = require('../database/vehicleQueryManager');
const { EmbedBuilder } = require('discord.js');

const NEW_VEHICLES_CHANNEL_ID = '1239688596080955492';


async function processDailySavedSearches() {
    try {
        const savedSearches = await getAllSavedSearches();
        for (const search of savedSearches) {
            console.log("Processing search for:", search.username);
            const results = await queryVehicles(search.yard_id, search.make || 'ANY', search.model || 'ANY', search.year_range || 'ANY', search.status || 'ACTIVE');
            if (results.length > 0) {
                const embeds = formatMessages(results, search);
                sendNotification(search.user_id, embeds);
            }
        }

        await notifyNewVehicles();

    } catch (error) {
        console.error('Error processing daily saved searches:', error);
    }
}

async function notifyNewVehicles() {
    try {
        const today = new Date().toISOString().substring(0, 10);
        const newVehicles = await queryVehicles('ALL', 'ANY', 'ANY', 'ANY', 'NEW', today);
        if (newVehicles.length > 0) {
            const embeds = formatVehicles(newVehicles, 'New Vehicles Added Today');
            sendChannelNotification(NEW_VEHICLES_CHANNEL_ID, embeds);
        }
    } catch (error) {
        console.error('Error notifying new vehicles:', error);
    }
}


function sendNotification(userId, embeds) {
    if (!client || !client.isReady()) {
        console.error('Discord client is not ready. Cannot send messages.');
        return;
    }

    client.users.fetch(userId).then(user => {
        user.send({ embeds }).then(() => {
            console.log(`Notification sent to ${user.tag}.`);
        }).catch(err => {
            console.error(`Failed to send notification to ${user.tag}:`, err);
        });
    }).catch(err => {
        console.error(`Failed to fetch user ${userId}:`, err);
    });
}

function sendChannelNotification(channelId, embeds) {
    if (!client || !client.isReady()) {
        console.error('Discord client is not ready. Cannot send messages.');
        return;
    }

    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        console.error(`Channel with ID ${channelId} not found.`);
        return;
    }

    channel.send({ embeds }).then(() => {
        console.log(`Notification sent to channel ${channelId}.`);
    }).catch(err => {
        console.error(`Failed to send notification to channel ${channelId}:`, err);
    });
}

function formatMessages(vehicles, search) {
    let embeds = [];
    const chunkSize = 25; // Maximum fields per embed
    const maxEmbeds = 10; // Maximum number of embeds per message

    for (let i = 0; i < vehicles.length && embeds.length < maxEmbeds; i += chunkSize) {
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
    const maxEmbeds = 10; // Maximum number of embeds per message

    for (let i = 0; i < vehicles.length && embeds.length < maxEmbeds; i += chunkSize) {
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

module.exports = { processDailySavedSearches };
