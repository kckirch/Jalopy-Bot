/**
 * discordBotMain.js
 * 
 * Main entry point for a Discord bot that manages interactions for vehicle inventory searches and updates.
 * This bot handles commands from Discord users to initiate searches based on yard, make, and model criteria,
 * scraping vehicle data from the Jalopy Jungle website and querying from a local database.
 * 
 * Key Features:
 * - Set up the database and initialize connection.
 * - Handle 'scrape' and 'search' commands to fetch vehicle data either by scraping online or querying the database.
 * - Utilizes Discord.js for bot interactions, creating interactive messages with buttons and handling user input.
 * 
 * Dependencies:
 * - dotenv for environment variable management.
 * - Discord.js for handling interactions with the Discord API.
 * - vehicleQueryManager and vehicleDbInventoryManager for database operations.
 * - jalopyJungleScraper for web scraping functionality.
 */

require('dotenv').config({ path: '../.env' });

const { client } = require('./client.js');

const { queryVehicles } = require('../database/vehicleQueryManager');

const { webScrape } = require('../scraping/jalopyJungleScraper');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { searchEmbed, savedSearchEmbed } = require('../testing/commandEmbeds');

const { setupDatabase } = require('../database/database');
const { getSavedSearches, addSavedSearch, checkExistingSearch, deleteSavedSearch } = require('../database/savedSearchManager');

const { processDailySavedSearches } = require('../notifications/dailyTasks');

const { startScheduledTasks } = require('../notifications/scheduler');

const { getSessionID } = require('./utils.js');

// Initialize database
setupDatabase().then(() => {
  console.log('Database setup completed successfully.');
}).catch((error) => {
  console.error('Failed to set up database:', error);
});

const yardIdMapping = {
  'BOISE': 1020,
  'CALDWELL': 1021,
  'GARDENCITY': 1119,
  'NAMPA': 1022,
  'TWINFALLS': 1099,
};

const treasureValleyYards = [1020, 1119, 1021, 1022]; // Boise, Garden City, Caldwell, Nampa

const vehicleMakes = [
  'ACURA', 'ALFA ROMEO', 'AMC', 'AUDI', 'BMW', 'BUICK', 'CADILLAC',
  'CHEVROLET', 'CHRYSLER', 'DATSUN', 'DODGE', 'EAGLE', 'FIAT', 'FORD', 'GEO',
  'GMC', 'HONDA', 'HUMMER', 'HYUNDAI', 'INFINITI', 'ISUZU',
  'JAGUAR', 'JEEP', 'KIA', 'LAND ROVER', 'LEXUS',
  'LINCOLN', 'MAZDA', 'MERCEDES-BENZ', 'MERCURY', 'MG', 'MINI', 'MITSUBISHI', 'NASH',
  'NISSAN', 'OLDSMOBILE', 'PACKARD', 'PLYMOUTH', 'PONTIAC', 'PORSCHE', 'RAM',
  'SAAB', 'SATURN', 'SCION', 'SMART', 'SUBARU', 'SUZUKI',
  'TOYOTA', 'TRIUMPH', 'VOLKSWAGEN', 'VOLVO'
];
const makeAliases = {
  'Chevrolet': ['CHEVROLET', 'CHEVY', 'CHEV', 'chevy'],
  'Mercedes': ['MERCEDES', 'MERCEDES-BENZ', 'MERCEDES BENZ', 'BENZ', 'MERCEDESBENZ'],
  'Volkswagen': ['VW'],
  'Land Rover': ['LAND ROVER', 'LANDROVER'],
  'Mini': ['MINI COOPER'],
  'BMW': ['BIMMER'],
};

// Create a reverse lookup map from the alias list
const reverseMakeAliases = Object.keys(makeAliases).reduce((acc, canonical) => {
  makeAliases[canonical].forEach(alias => {
    acc[alias.toUpperCase()] = canonical;
  });
  return acc;
}, {});

const ADMIN_ROLE_NAME = 'Admin'; // Replace with your admin role name

async function isAdmin(interaction) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.roles.cache.some(role => role.name === ADMIN_ROLE_NAME);
}

// Global reference for the message collector
let messageCollector = null;

client.on('ready', async (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
  try {
    startScheduledTasks();
    console.log('Scheduled tasks started.');
    console.log("Current server time:", new Date().toLocaleString());

  } catch (error) {
    console.error('Failed to start scheduled tasks:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    const user = interaction.user.tag;  // Discord tag of the user who initiated the interaction
    const channelId = interaction.channelId;  // Channel ID where the interaction occurred

    // Check if the interaction is a command
    if (interaction.isCommand()) {
      const commandName = interaction.commandName;
      console.log(`\n\n\nCommand received: ${commandName} from ${user} in channel ${channelId}`);

      const options = interaction.options.data.map(opt => `${opt.name}: ${opt.value}`).join(', ');
      console.log(`Options: ${options}`);

      // Check for admin role for restricted commands
      const restrictedCommands = ['scrape', 'dailysavedsearch', 'runtestscheduler', 'commands'];
      if (restrictedCommands.includes(commandName) && !await isAdmin(interaction)) {
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }

      if (commandName === 'scrape') {
        await handleScrapeCommand(interaction);
      } else if (commandName === 'search') {
        await handleSearchCommand(interaction);
      } else if (commandName === 'savedsearch') {
        await handleSavedSearchCommand(interaction);
      } else if (commandName === 'dailysavedsearch') {
        await handleDailySavedSearchCommand(interaction);
      } else if (commandName === 'runtestscheduler') {
        await handleRunTestSchedulerCommand(interaction);
      } else if (commandName === 'commands') {
        await handleCommandsCommand(interaction);
      }
    }

    // Check if the interaction is a button click
    if (interaction.isButton()) {
      const buttonId = interaction.customId;
      console.log(`Button clicked: ${buttonId} by ${user}`);
      await handleButtonClick(interaction, buttonId);
    }

    // Handle other types of interactions similarly

  } catch (error) {
    console.error('Error processing interaction:', error);
    await interaction.reply('An error occurred while processing your request.');
  }
});

async function handleScrapeCommand(interaction) {
  let location = interaction.options.getString('location');
  let make = interaction.options.getString('make') || 'Any';
  let model = interaction.options.getString('model') || 'Any';

  const sessionID = getSessionID();
  console.log(`Session ID: ${sessionID}`);

  if (location && make) {
    make = make.toUpperCase();
    model = model.toUpperCase();
    const yardId = convertLocationToYardId(location);

    // Call the webScrape function with the parameters
    console.log(`Starting web scrape with sessionID: ${sessionID}`); // This should log a proper sessionID

    webScrape(yardId, make, model, sessionID);
  }

  if (location && !make) {
    const makesEmbed = new EmbedBuilder()
      .setTitle('Available Vehicle Makes in ' + location)
      .setDescription('Please reply with the make of the vehicle you are interested in.')
      .addFields({ name: 'Makes', value: vehicleMakes.join(', ') })
      .setColor('Orange');

    await interaction.reply({ embeds: [makesEmbed] });

    const filter = m => m.author.id === interaction.user.id;
    messageCollector = interaction.channel.createMessageCollector({ filter, time: 60000 });

    messageCollector.on('collect', async m => {
      try {
        const makeInput = m.content.toUpperCase();

        if (vehicleMakes.map(make => make.toUpperCase()).includes(makeInput)) {
          // Create an embed similar to the 'Search Parameters' embed
          const resultEmbed = new EmbedBuilder()
            .setTitle('Search Parameters')
            .setDescription('Here are your scrape search parameters:')
            .addFields(
              { name: 'Location', value: location },
              { name: 'Make', value: m.content }, // Use the collected make
              { name: 'Model', value: 'Any' } // Assuming model is not yet selected
            )
            .setColor('Orange');

          await interaction.followUp({ embeds: [resultEmbed] });
          messageCollector.stop();
        } else {
          const quitButton = new ButtonBuilder()
            .setCustomId('quit')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger);

          const row = new ActionRowBuilder().addComponents(quitButton);

          await m.reply({
            content: `"${makeInput}" is not a valid make. Please choose from the list or cancel the operation.`,
            components: [row]
          });
        }
      } catch (error) {
        console.error('Error handling collected make:', error);
        await m.reply('An error occurred while processing your request.');
      }
    });

    messageCollector.on('end', collected => {
      if (collected.size === 0) {
        interaction.followUp('No valid make was provided.');
      }
    });
  } else if (location && make) {
    // Process the search with both location and make provided
    const searchEmbed = new EmbedBuilder()
      .setTitle('Search Parameters')
      .setDescription('Here are your search parameters:')
      .addFields(
        { name: 'Location', value: location },
        { name: 'Make', value: make },
        { name: 'Model', value: model || 'Any' }
      )
      .setColor('Orange');

    await interaction.reply({ embeds: [searchEmbed] });
    // Implement the search logic here
  }
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

  // Skip make validation if it is empty
  if (userMakeInput === 'ANY') {
    console.log('Make is empty, skipping validation.');
  } else {
    // First check directly in vehicleMakes
    if (vehicleMakes.includes(userMakeInput)) {
      console.log(`Direct make found: ${userMakeInput}`);
    } else {
      // If not found, check for a canonical name via makeAliases
      const canonicalMake = reverseMakeAliases[userMakeInput];
      if (canonicalMake && vehicleMakes.includes(canonicalMake.toUpperCase())) {
        userMakeInput = canonicalMake;  // Update userMakeInput to the canonical form
        console.log(` 🚗 Canonical Make Found: ${canonicalMake}`);
      } else {
        // If the make is still not recognized, inform the user and list available options
        const makesEmbed = new EmbedBuilder()
          .setColor(0x0099FF)  // A visually appealing color
          .setTitle('Available Vehicle Makes')
          .setDescription('The make you entered is not recognized. Please choose from the list below.')
          .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });

        await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
        console.log('No valid make found, search ended.');
        return;  // Stop further execution if make is not valid
      }
    }
  }

  if (location) {
    const yardId = convertLocationToYardId(location);

    try {
      let vehicles = await queryVehicles(yardId, userMakeInput, model, yearInput, status); //need to fix this line for status
      // Sort vehicles first by 'first_seen' in descending order, then by 'model' alphabetically
      vehicles.sort((a, b) => {
        const firstSeenA = new Date(a.first_seen);
        const firstSeenB = new Date(b.first_seen);
        return firstSeenB - firstSeenA || a.vehicle_model.localeCompare(b.vehicle_model);  // Sort by first_seen descending, then alphabetically by model
      });

      const itemsPerPage = 20;
      let currentPage = 0;
      const totalPages = Math.ceil(vehicles.length / itemsPerPage);

      const getPage = (page) => {
        const start = page * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = vehicles.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor(0x0099FF) // Set a visually appealing color
          .setTitle(`Database search results for ${location} ${userMakeInput || 'Any'} ${model} (${yearInput}) ${status}`)
          .setTimestamp();

        if (vehicles.length === 0) {
          embed.setDescription('No Results Found')
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

      const updateComponents = (currentPage, userId) => new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`previous:${userId}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0 || vehicles.length === 0),
          new ButtonBuilder()
            .setCustomId(`next:${userId}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1 || vehicles.length === 0),
          new ButtonBuilder()
            .setCustomId(`save:${yardId}:${userMakeInput}:${model}:${yearInput}:${status}:${userId}`)
            .setLabel('Save Search')
            .setStyle(ButtonStyle.Success)
            .setDisabled(vehicles.length === 0)
        );

      // Example usage:
      const message = await interaction.reply({ embeds: [getPage(0)], components: [updateComponents(0, interaction.user.id)], fetchReply: true });

      const collector = message.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 120000 });

      collector.on('collect', async i => {
        const parts = i.customId.split(':');
        const action = parts[0];
        const userId = parts[parts.length - 1];  // User ID is always the last part of the customId
        const yardName = convertYardIdToLocation(yardId);

        if (userId !== i.user.id) {
          await i.reply({ content: "You do not have permission to perform this action.", ephemeral: true });
          return;
        }

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
            const yardId = parts[1];
            const make = parts[2];
            const model = parts[3];
            const yearInput = parts[4];

            console.log(`Attempting to save or check existing search: YardID=${yardId}, Make=${make}, Model=${model}, Year=${yearInput}, Status=${status}`);

            try {
              const exists = await checkExistingSearch(i.user.id, yardId, userMakeInput, model, yearInput, status);
              if (!exists) {
                await addSavedSearch(i.user.id, i.user.tag, yardId, yardName, userMakeInput, model, yearInput, status, '');
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

async function handleSavedSearchCommand(interaction) {
  console.log('Saved search retrieval command received.');

  const userId = interaction.user.id;
  const location = interaction.options.getString('location');
  let yardId = location ? convertLocationToYardId(location) : null;  // Convert location to yardId if provided
  console.log(`Retrieving saved searches for user ${userId} in location ${location || 'All'}`);
  try {
    await interaction.deferReply({ ephemeral: true });
    const savedSearches = await getSavedSearches(userId, yardId);
    if (savedSearches.length > 0) {
      let currentIndex = 0; // Start from the first saved search

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
      const user = await client.users.fetch(userId);  // Fetch the user object
      const dmChannel = await user.createDM();  // Create a DM channel with the user
      const dmMessage = await dmChannel.send({ embeds: [initialMessage.embed], components: [initialMessage.components] });

      const filter = i => i.user.id === interaction.user.id;
      const collector = dmMessage.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async i => {
        const [action, index] = i.customId.split(':');

        if (action === 'next' || action === 'prev') {
          const newIndex = action === 'next' ? parseInt(index) + 1 : parseInt(index) - 1;
          currentIndex = newIndex; // Update the current index based on the action
          const update = updateEmbedAndComponents(currentIndex);
          await i.update({ embeds: [update.embed], components: [update.components] });
        } else if (action === 'delete') {
          await deleteSavedSearch(savedSearches[currentIndex].id);
          savedSearches.splice(currentIndex, 1); // Remove the search from the array
          if (savedSearches.length === 0) {
            await i.update({ content: 'All saved searches have been deleted.', components: [], embeds: [] });
            return;
          }
          currentIndex = Math.min(currentIndex, savedSearches.length - 1); // Adjust index if needed
          const update = updateEmbedAndComponents(currentIndex);
          await i.update({ embeds: [update.embed], components: [update.components] });
        }
      });

      collector.on('end', async () => {
        if (dmMessage) {
          await dmMessage.edit({ components: [] }); // Hide the buttons
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


async function handleDailySavedSearchCommand(interaction) {
  console.log('Daily saved search command received.');
  try {
    await processDailySavedSearches();
    await interaction.reply('Daily saved searches processed successfully.');
  } catch (error) {
    console.error('Error processing daily saved searches:', error);
    await interaction.reply('An error occurred while processing daily saved searches.');
  }
}

async function handleRunTestSchedulerCommand(interaction) {
  console.log('Test scheduler command received.');

  // Immediately acknowledge the interaction
  await interaction.deferReply(); // This prevents the "Application did not respond" message

  try {
    const { performScrape, processSearches } = require('../notifications/testScheduler');
    await performScrape();
    await processSearches();
    await interaction.editReply('Test scheduler functions have been executed successfully.'); // Use editReply after deferReply
  } catch (error) {
    console.error('Error running test scheduler:', error);
    await interaction.editReply('An error occurred while running the test scheduler.'); // Update the user on errors similarly
  }
}

async function handleCommandsCommand(interaction) {
  console.log('Commands showcase command received.');
  await interaction.reply({ embeds: [searchEmbed, savedSearchEmbed] });
}

async function handleButtonClick(interaction, buttonId) {
  if (buttonId === 'quit') {
    if (messageCollector) {
      messageCollector.stop();
      messageCollector = null; // Reset the collector reference
    }
    await interaction.update({ content: 'Operation cancelled.', components: [] });
  } else {
    // Handle other button clicks here
  }
}

function convertLocationToYardId(location) {
  if (location.toUpperCase() === 'ALL') {
    return 'ALL';
  } else if (location.toUpperCase() === 'TREASUREVALLEYYARDS') {
    return treasureValleyYards;  // Return an array of yard IDs
  }
  const normalizedLocation = location.toUpperCase().replace(/\s/g, '');
  return yardIdMapping[normalizedLocation] || 'ALL';
}

function convertYardIdToLocation(yardId) {
  console.log("Received yardId:", yardId); // Log the input to see what is received

  if (yardId === 'ALL') {
    // Return all yard names joined by commas if 'ALL' is received
    const allYardNames = Object.keys(yardIdMapping).map(key => key.replace(/[A-Z]/g, ' $&').trim()); // Convert keys like 'BOISE' to 'Boise'
    return allYardNames.join(', ');
  } else if (Array.isArray(yardId)) {
    // Handle array of yard IDs by converting each ID to its corresponding yard name
    const yardNames = yardId.map(id => {
      const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(id));
      return yardKey || 'Unknown Yard'; // If no key found, return 'Unknown Yard'
    });
    return yardNames.join(', '); // Join all names with comma for readable format
  } else if (typeof yardId === 'string' && yardId.includes(',')) {
    // Split the string by commas, convert to array of names
    return yardId.split(',').map(id => {async function handleSavedSearchCommand(interaction) {
      console.log('Saved search retrieval command received.');
    
      const userId = interaction.user.id;
      const location = interaction.options.getString('location');
      let yardId = location ? convertLocationToYardId(location) : null;  // Convert location to yardId if provided
      console.log(`Retrieving saved searches for user ${userId} in location ${location || 'All'}`);
      try {
        const savedSearches = await getSavedSearches(userId, yardId);
        if (savedSearches.length > 0) {
          let currentIndex = 0; // Start from the first saved search
    
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
          const user = await client.users.fetch(userId);  // Fetch the user object
          const dmChannel = await user.createDM();  // Create a DM channel with the user
          await dmChannel.send({ embeds: [initialMessage.embed], components: [initialMessage.components] });
    
          const filter = i => i.user.id === interaction.user.id;
          const collector = dmChannel.createMessageComponentCollector({ filter, time: 60000 });
    
          collector.on('collect', async i => {
            const [action, index] = i.customId.split(':');
    
            if (action === 'next' || action === 'prev') {
              const newIndex = action === 'next' ? parseInt(index) + 1 : parseInt(index) - 1;
              currentIndex = newIndex; // Update the current index based on the action
              const update = updateEmbedAndComponents(currentIndex);
              await i.update({ embeds: [update.embed], components: [update.components] });
            } else if (action === 'delete') {
              await deleteSavedSearch(savedSearches[currentIndex].id);
              savedSearches.splice(currentIndex, 1); // Remove the search from the array
              if (savedSearches.length === 0) {
                await i.update({ content: 'All saved searches have been deleted.', components: [], embeds: [] });
                return;
              }
              currentIndex = Math.min(currentIndex, savedSearches.length - 1); // Adjust index if needed
              const update = updateEmbedAndComponents(currentIndex);
              await i.update({ embeds: [update.embed], components: [update.components] });
            }
          });
    
          collector.on('end', async () => {
            if (dmChannel.lastMessage) {
              await dmChannel.lastMessage.edit({ components: [] }); // Hide the buttons
            }
          });
    
          await interaction.reply({ content: 'Check your DMs for your saved searches.', ephemeral: true });
    
        } else {
          await interaction.reply({ content: 'You have no saved searches matching the criteria.', ephemeral: true });
        }
      } catch (error) {
        console.error('Error retrieving saved searches:', error);
        await interaction.reply({ content: 'Failed to retrieve saved searches.', ephemeral: true });
      }
    }
    
      const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(id.trim()));
      return yardKey || 'Unknown Yard'; // If no key found, return 'Unknown Yard'
    }).join(', ');
  } else if (typeof yardId === 'number' || (typeof yardId === 'string' && !isNaN(parseInt(yardId)))) {
    // Convert single yard ID (number or string) to yard name
    const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(yardId));
    return yardKey || 'Unknown Yard'; // If no key found, return 'Unknown Yard'
  } else {
    // Handle unexpected input type
    console.error('Unexpected yardId input type:', typeof yardId);
    return 'Invalid Yard ID'; // Fallback for undefined or unexpected types
  }
}

module.exports = { getSessionID, client };

client.login(process.env.TOKEN);
