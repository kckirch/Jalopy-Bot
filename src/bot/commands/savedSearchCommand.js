const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSavedSearches, deleteSavedSearch } = require('../../database/savedSearchManager');
const { convertLocationToYardId } = require('../utils/locationUtils');
const { queryVehicles } = require('../../database/vehicleQueryManager');
const { client } = require('../utils/client');

const MATCH_PREVIEW_LIMIT = 5;

function sortVehiclesByMostRecent(rows) {
  return [...rows].sort((a, b) => {
    const lastUpdatedA = new Date(a.last_updated);
    const lastUpdatedB = new Date(b.last_updated);
    return lastUpdatedB - lastUpdatedA;
  });
}

function buildMatchSummary(search, vehicles) {
  if (!vehicles || vehicles.length === 0) {
    return {
      fieldName: 'Current DB Matches',
      fieldValue: `No matches right now for ${search.make} ${search.model} (${search.year_range}) ${search.status}.`,
    };
  }

  const topRows = sortVehiclesByMostRecent(vehicles).slice(0, MATCH_PREVIEW_LIMIT);
  const lines = topRows.map((vehicle) =>
    `${vehicle.vehicle_year} ${vehicle.vehicle_make} ${vehicle.vehicle_model} | ${vehicle.yard_name} Row ${vehicle.row_number}`
  );
  const remaining = vehicles.length - topRows.length;
  if (remaining > 0) {
    lines.push(`...and ${remaining} more`);
  }

  return {
    fieldName: `Current DB Matches (${vehicles.length})`,
    fieldValue: lines.join('\n').slice(0, 1024),
  };
}

function buildSavedSearchComponents(currentIndex, totalCount) {
  const navigationRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`prev:${currentIndex}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === 0),
      new ButtonBuilder().setCustomId(`next:${currentIndex}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === totalCount - 1),
      new ButtonBuilder().setCustomId(`delete:${currentIndex}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
    );

  const quickActionsRow = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder().setCustomId(`check:${currentIndex}`).setLabel('Check Matches').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('deleteall').setLabel('Delete All').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('close').setLabel('Close').setStyle(ButtonStyle.Secondary)
    );

  return [navigationRow, quickActionsRow];
}

async function handleSavedSearchCommand(interaction) {
  console.log('Saved search retrieval command received.');
  const userId = interaction.user.id;
  const location = interaction.options.getString('location');
  let yardId = location ? convertLocationToYardId(location) : null;
  console.log(`Retrieving saved searches for user ${userId} in location ${location || 'All'}`);

  try {
    await interaction.deferReply({ ephemeral: true });
    const savedSearches = await getSavedSearches(userId, yardId);
    console.log('Retrieved saved searches successfully.');
    
    if (savedSearches.length > 0) {
      let currentIndex = 0;
      let currentMatchSummary = null;

      const updateEmbedAndComponents = (index) => {
        const search = savedSearches[index];
        const createDate = new Date(search.create_date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const lastUpdatedDate = new Date(search.update_date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`Saved Search: ${search.make} ${search.model} (${search.year_range})`)
          .setDescription(`Yard: ${search.yard_name}\nStatus: ${search.status}\nCreated: ${createDate}\nLast Updated: ${lastUpdatedDate}`)
          .setFooter({ text: `Viewing ${index + 1} of ${savedSearches.length}` });

        if (currentMatchSummary && currentMatchSummary.fieldName && currentMatchSummary.fieldValue) {
          embed.addFields({
            name: currentMatchSummary.fieldName,
            value: currentMatchSummary.fieldValue,
          });
        }

        const components = buildSavedSearchComponents(currentIndex, savedSearches.length);

        return { embed, components };
      };

      const initialMessage = updateEmbedAndComponents(currentIndex);
      const user = await client.users.fetch(userId);
      const dmChannel = await user.createDM();
      const dmMessage = await dmChannel.send({ embeds: [initialMessage.embed], components: [initialMessage.components] });

      const filter = i => i.user.id === interaction.user.id;
      const collector = dmMessage.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async i => {
        try {
          const [action, index] = i.customId.split(':');

          if (action === 'next' || action === 'prev') {
            const newIndex = action === 'next' ? parseInt(index, 10) + 1 : parseInt(index, 10) - 1;
            currentIndex = newIndex;
            currentMatchSummary = null;
            const update = updateEmbedAndComponents(currentIndex);
            await i.update({ embeds: [update.embed], components: update.components });
          } else if (action === 'delete') {
            await deleteSavedSearch(savedSearches[currentIndex].id);
            savedSearches.splice(currentIndex, 1);
            currentMatchSummary = null;

            if (savedSearches.length === 0) {
              await i.update({ content: 'All saved searches have been deleted.', components: [], embeds: [] });
              collector.stop('all_deleted');
              return;
            }

            currentIndex = Math.min(currentIndex, savedSearches.length - 1);
            const update = updateEmbedAndComponents(currentIndex);
            await i.update({ embeds: [update.embed], components: update.components });
          } else if (action === 'check') {
            const currentSearch = savedSearches[currentIndex];
            const vehicles = await queryVehicles(
              currentSearch.yard_id,
              currentSearch.make || 'ANY',
              currentSearch.model || 'ANY',
              currentSearch.year_range || 'ANY',
              currentSearch.status || 'ACTIVE'
            );
            currentMatchSummary = buildMatchSummary(currentSearch, vehicles);
            const update = updateEmbedAndComponents(currentIndex);
            await i.update({ embeds: [update.embed], components: update.components });
          } else if (action === 'deleteall') {
            const idsToDelete = savedSearches.map((savedSearch) => savedSearch.id);
            for (const searchId of idsToDelete) {
              await deleteSavedSearch(searchId);
            }
            savedSearches.splice(0, savedSearches.length);
            currentMatchSummary = null;
            await i.update({ content: 'All saved searches have been deleted.', components: [], embeds: [] });
            collector.stop('all_deleted');
          } else if (action === 'close') {
            await i.update({ content: 'Saved search session closed.', components: [], embeds: [] });
            collector.stop('closed');
          } else {
            await i.reply({ content: 'Unknown action.' });
          }
        } catch (collectorError) {
          console.error('Saved search interaction failed:', collectorError);
          await i.reply({ content: 'Unable to process that saved-search action right now.' });
        }
      });

      collector.on('end', async (_collected, reason) => {
        if (dmMessage && reason !== 'all_deleted' && reason !== 'closed') {
          await dmMessage.edit({ components: [] });
        }
      });

      await interaction.editReply({ content: 'Check your DMs for your saved searches.' });

    } else {
      await interaction.editReply({ content: 'You have no saved searches matching the criteria.' });
    }
  } catch (error) {
    console.error('Error retrieving saved searches:', error);
    await interaction.editReply({ content: 'Failed to retrieve saved searches.' });
  }
}

module.exports = { handleSavedSearchCommand };
