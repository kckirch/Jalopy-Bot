const { queryVehicles } = require('../../database/vehicleQueryManager');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { vehicleMakes, reverseMakeAliases, convertLocationToYardId, convertYardIdToLocation } = require('../utils/locationUtils');
const { getSavedSearches, deleteSavedSearch, checkExistingSearch, addSavedSearch } = require('../../database/savedSearchManager');
const crypto = require('crypto');

const parameterStore = new Map();

function generateHash(parameters) {
  const hash = crypto.createHash('md5').update(parameters).digest('hex');
  parameterStore.set(hash, parameters);
  return hash;
}

function resolveHash(hash) {
  return parameterStore.get(hash);
}

async function handleSearchCommand(interaction) {
  const location = interaction.options.getString('location');
  let userMakeInput = (interaction.options.getString('make') || 'Any').toUpperCase();
  let model = (interaction.options.getString('model') || 'Any').toUpperCase();
  let yearInput = (interaction.options.getString('year') || 'Any');
  let status = (interaction.options.getString('status') || 'ACTIVE').toUpperCase();

  console.log('🔍 DB Lookup for:');
  console.log(`   🏞️ Location: ${location}`);
  console.log(`   🚗 Make: ${userMakeInput}`);
  console.log(`   📋 Model: ${model}`);
  console.log(`   📅 Year: ${yearInput}`);
  console.log(`   📊 Status: ${status}`);

  if (userMakeInput === 'ANY') {
    console.log('Make is empty, skipping validation.');
  } else {
    if (vehicleMakes.includes(userMakeInput)) {
      console.log(`Direct make found: ${userMakeInput}`);
    } else {
      const canonicalMake = reverseMakeAliases[userMakeInput];
      if (canonicalMake && vehicleMakes.includes(canonicalMake.toUpperCase())) {
        userMakeInput = canonicalMake;
        console.log(` 🚗 Canonical Make Found: ${canonicalMake}`);
      } else {
        const makesEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('Available Vehicle Makes')
          .setDescription('The make you entered is not recognized. Please choose from the list below.')
          .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });

        await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
        console.log('No valid make found, search ended.');
        return;
      }
    }
  }

  if (location) {
    const yardId = convertLocationToYardId(location);

    try {
      let vehicles = await queryVehicles(yardId, userMakeInput, model, yearInput, status);
      vehicles.sort((a, b) => {
        const firstSeenA = new Date(a.first_seen);
        const firstSeenB = new Date(b.first_seen);
        return firstSeenB - firstSeenA || a.vehicle_model.localeCompare(b.vehicle_model);
      });

      const itemsPerPage = 20;
      let currentPage = 0;
      const totalPages = Math.ceil(vehicles.length / itemsPerPage);

      const getPage = (page) => {
        const start = page * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = vehicles.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`Database search results for ${location} ${userMakeInput || 'Any'} ${model} (${yearInput}) ${status}`)
          .setTimestamp();

        if (vehicles.length === 0) {
          embed.setDescription('No Results Found.\n\nPlease double check your Model naming if you are certain it should be in the yard.\nRemember simpler is usually better :)')
            .setFooter({ text: 'Page 0 of 0' });
        } else {
          embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
          pageItems.forEach(v => {
            const firstSeen = new Date(v.first_seen);
            const lastUpdated = new Date(v.last_updated);
            const firstSeenFormatted = `${firstSeen.getMonth() + 1}/${firstSeen.getDate()}`;
            const lastUpdatedFormatted = `${lastUpdated.getMonth() + 1}/${lastUpdated.getDate()}`;
            let vehicleDescription = `Yard: ${yardId === 'ALL' || Array.isArray(yardId) ? v.yard_name : ''}, Row: ${v.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`;

            if (v.notes) {
              vehicleDescription += `\nNotes: ${v.notes}`;
            }

            embed.addFields({
              name: `${v.vehicle_make} ${v.vehicle_model} (${v.vehicle_year})`,
              value: vehicleDescription,
              inline: false
            });
          });
        }

        return embed;
      };

      const updateComponents = (currentPage, userId) => {
        try {
          const createCustomId = (action) => {
            const parameters = `pg:${currentPage}|act:${action}|uid:${userId}|yd:${yardId}|mk:${userMakeInput}|md:${model}|yr:${yearInput}|st:${status}`;
            return generateHash(parameters);
          };

          return new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(createCustomId('previous'))
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === 0 || vehicles.length === 0),
              new ButtonBuilder()
                .setCustomId(createCustomId('next'))
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(currentPage === totalPages - 1 || vehicles.length === 0),
              new ButtonBuilder()
                .setCustomId(createCustomId('save'))
                .setLabel('Save Search')
                .setStyle(ButtonStyle.Success)
                .setDisabled(false)  // Always enabled
            );
        } catch (error) {
          console.error('Error creating custom ID:', error);
          throw error;
        }
      };

      const message = await interaction.reply({ embeds: [getPage(0)], components: [updateComponents(0, interaction.user.id)], fetchReply: true });

      const collector = message.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 120000 });

      collector.on('collect', async i => {
        try {
          const parameters = resolveHash(i.customId);
          if (!parameters) {
            await i.reply({ content: 'Invalid or expired interaction.', ephemeral: true });
            return;
          }

          const parts = parameters.split('|').reduce((acc, part) => {
            const [key, value] = part.split(':');
            acc[key] = value;
            return acc;
          }, {});

          const action = parts['act'];
          const userId = parts['uid'];

          if (userId !== i.user.id) {
            await i.reply({ content: "You do not have permission to perform this action.", ephemeral: true });
            return;
          }

          let currentPage = parseInt(parts['pg']);
          const yardId = parts['yd'];
          const make = parts['mk'];
          const model = parts['md'];
          const yearInput = parts['yr'];
          const status = parts['st'];
          const yardName = convertYardIdToLocation(yardId); // Make sure yardName is defined here

          switch (action) {
            case 'next':
            case 'previous':
              const pageChange = (action === 'next') ? 1 : -1;
              currentPage += pageChange;
              await i.update({
                embeds: [getPage(currentPage)],
                components: [updateComponents(currentPage, userId)]
              });
              break;

            case 'save':
              console.log(`Attempting to save or check existing search: YardID=${yardId}, Make=${make}, Model=${model}, Year=${yearInput}, Status=${status}`);

              try {
                const exists = await checkExistingSearch(i.user.id, yardId, make, model, yearInput, status);
                if (!exists) {
                  await addSavedSearch(i.user.id, i.user.tag, yardId, yardName, make, model, yearInput, status, '');
                  await i.reply({ content: 'Search saved successfully! To remove Saved Search Use /savedsearch', ephemeral: true });
                } else {
                  await i.reply({ content: 'This search has already been saved.', ephemeral: true });
                }
              } catch (error) {
                console.error('Error checking for existing search:', error);
                await i.reply({ content: 'Error checking for existing searches.', ephemeral: true });
              }
              break;
          }
        } catch (error) {
          console.error('Error processing button interaction:', error);
          await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
      });

      collector.on('end', () => {
        if (message) {
          message.edit({ components: [] });
        }
      });

    } catch (error) {
      console.error('Error querying vehicles:', error);
      await interaction.reply({ content: 'Error fetching data from the database.', ephemeral: true });
    }

  } else {
    await interaction.reply({ content: 'Location is required for this search.', ephemeral: true });
  }
}

module.exports = { handleSearchCommand };
