//dailyTasks.js is a module that contains the processDailySavedSearches function. This function is responsible for querying the database for all saved searches and sending a notification to the user if any vehicles match the search criteria. The function is called once a day by the scheduler module.

const { client } = require('../bot/client');
const { getAllSavedSearches } = require('../database/savedSearchManager');
const { queryVehicles } = require('../database/vehicleQueryManager');

const { EmbedBuilder } = require('discord.js');



async function processDailySavedSearches() {
    try {
        const savedSearches = await getAllSavedSearches();
        for (const search of savedSearches) {
            console.log("Processing search for:", search.username);
            const results = await await queryVehicles(search.yard_id, search.make || 'ANY', search.model || 'ANY', search.year_range || 'ANY', search.status || 'Active');
            if (results.length > 0) {
                const embeds = formatMessages(results, search);
                sendNotification(search.user_id, embeds);
            }
        }
    } catch (error) {
        console.error('Error processing daily saved searches:', error);
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

            embed.addFields({
                name: `${vehicle.vehicle_make} ${vehicle.vehicle_model} (${vehicle.vehicle_year})`,
                value: `Yard: ${vehicle.yard_name}, Row: ${vehicle.row_number}\nFirst Seen: ${firstSeenFormatted}\nLast Updated: ${lastUpdatedFormatted}`,
                inline: false
            });
        });

        embeds.push(embed);
    }

    return embeds;
}


module.exports = { processDailySavedSearches };
