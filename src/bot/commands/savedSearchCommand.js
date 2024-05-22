const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSavedSearches, deleteSavedSearch, checkExistingSearch, addSavedSearch } = require('../../database/savedSearchManager');
const { convertLocationToYardId, convertYardIdToLocation } = require('../utils/locationUtils');
const { client } = require('../utils/client');  // Import the client

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

      const updateEmbedAndComponents = (index) => {
        const search = savedSearches[index];
        const createDate = new Date(search.create_date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const lastUpdatedDate = new Date(search.update_date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`Saved Search: ${search.make} ${search.model} (${search.year_range})`)
          .setDescription(`Yard: ${search.yard_name}\nStatus: ${search.status}\nCreated: ${createDate}\nLast Updated: ${lastUpdatedDate}`)
          .setFooter({ text: `Viewing ${index + 1} of ${savedSearches.length}` });

        const components = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId(`prev:${currentIndex}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === 0),
            new ButtonBuilder().setCustomId(`next:${currentIndex}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === savedSearches.length - 1),
            new ButtonBuilder().setCustomId(`delete:${currentIndex}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
          );

        return { embed, components };
      };

      const initialMessage = updateEmbedAndComponents(currentIndex);
      const user = await client.users.fetch(userId);
      const dmChannel = await user.createDM();
      const dmMessage = await dmChannel.send({ embeds: [initialMessage.embed], components: [initialMessage.components] });

      const filter = i => i.user.id === interaction.user.id;
      const collector = dmMessage.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async i => {
        const [action, index] = i.customId.split(':');

        if (action === 'next' || action === 'prev') {
          const newIndex = action === 'next' ? parseInt(index) + 1 : parseInt(index) - 1;
          currentIndex = newIndex;
          const update = updateEmbedAndComponents(currentIndex);
          await i.update({ embeds: [update.embed], components: [update.components] });
        } else if (action === 'delete') {
          await deleteSavedSearch(savedSearches[currentIndex].id);
          savedSearches.splice(currentIndex, 1);
          if (savedSearches.length === 0) {
            await i.update({ content: 'All saved searches have been deleted.', components: [], embeds: [] });
            return;
          }
          currentIndex = Math.min(currentIndex, savedSearches.length - 1);
          const update = updateEmbedAndComponents(currentIndex);
          await i.update({ embeds: [update.embed], components: [update.components] });
        }
      });

      collector.on('end', async () => {
        if (dmMessage) {
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
