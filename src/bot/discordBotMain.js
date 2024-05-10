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




require('dotenv').config({ path: '../.env'});

const { client, } = require('./client.js');

const { queryVehicles } = require('../database/vehicleQueryManager');



const { webScrape } = require('../scraping/jalopyJungleScraper');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const { setupDatabase } = require('../database/database');
const { getSavedSearches, addSavedSearch, checkExistingSearch, deleteSavedSearch } = require('../database/savedSearchManager');

const { processDailySavedSearches } = require('../notifications/dailyTasks');

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
  'Acura', 'Alfa Romeo', 'AMC', 'Audi', 'BMW', 'Buick', 'Cadillac', 
  'Chevrolet', 'Chrysler', 'Datsun', 'Dodge', 'Eagle', 'Fiat', 'Ford', 'Geo', 
  'GMC', 'Honda', 'Hummer', 'Hyundai', 'Infiniti', 'Isuzu', 
  'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 
  'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mercury', 'MG', 'Mini', 'Mitsubishi', 'Nash',
  'Nissan', 'Oldsmobile', 'Packard', 'Plymouth', 'Pontiac', 'Porsche', 'Ram',
  'Saab', 'Saturn', 'Scion', 'Smart', 'Subaru', 'Suzuki', 
  'Toyota', 'Triumph', 'Volkswagen', 'Volvo'
];
const makeAliases = {
  'Chevrolet' : ['chevrolet', 'chevy', 'chev'],
  'Mercedes' : ['mercedes', 'mercedes-benz', 'mercedes benz', 'benz', 'mercedesbenz'],
  'Volkswagen' : ['volkswagen', 'vw'],
  'Land Rover' : ['land rover', 'landrover'],
  'Mini' : ['mini', 'mini cooper'],
  'BMW' : ['bmw', 'bimmer'],
};

// Create a reverse lookup map from the alias list
const reverseMakeAliases = Object.keys(makeAliases).reduce((acc, canonical) => {
  makeAliases[canonical].forEach(alias => {
      acc[alias.toLowerCase()] = canonical; // Use lower case for case insensitive comparison
  });
  return acc;
}, {});

function getSessionID() {
  const today = new Date();
  return today.toISOString().substring(0, 10).replace(/-/g, '');  // Format as 'YYYYMMDD'
}




// Global reference for the message collector
let messageCollector = null;

client.on('ready', (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
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
  } 
  // Check if the interaction is a button click
  else if (interaction.isButton()) {
      const buttonId = interaction.customId;
      console.log(`Button clicked: ${buttonId} by ${user} in channel ${channelId}`);
  } 
  // Handle other types of interactions similarly
  else {
      console.log(`Interaction received from ${user} in channel ${channelId}`);
      console.log(`Interaction details: ${JSON.stringify(interaction, null, 2)}`);
  }
        
  // Command interaction for 'search'
  if (interaction.isChatInputCommand() && interaction.commandName === 'scrape') {
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
    } else if (interaction.commandName === 'search') {
      console.log('Database search command received.');
  
      const location = interaction.options.getString('location');
      let userMakeInput = (interaction.options.getString('make') || 'Any').toLowerCase();
      let model = (interaction.options.getString('model') || 'Any').toUpperCase();
      let yearInput = (interaction.options.getString('year') || 'Any');
  
      console.log('🔍 DB Lookup for:');
      console.log(`   🏞️ Location: ${location}`);
      console.log(`   🚗 Make: ${userMakeInput}`);
      console.log(`   📋 Model: ${model}`);
  
      if (userMakeInput !== 'any') {
          let canonicalMake = reverseMakeAliases[userMakeInput] || userMakeInput; // Resolve the make alias to its canonical form

          if (vehicleMakes.includes(canonicalMake)) {
            console.log(`   🚗 Canonical Make Found: ${canonicalMake}\n\n`);
          }
  
          if (!vehicleMakes.includes(canonicalMake)) {
              // If the canonical make is not recognized, inform the user and list available options
              const makesEmbed = new EmbedBuilder()
                  .setColor(0x0099FF) // Set a visually appealing color
                  .setTitle('Available Vehicle Makes')
                  .setDescription('The make you entered is not recognized. Please choose from the list below.')
                  .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });
  
              await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
              console.log(`no valid make found, search ended\n\n`);
              return; // Stop further execution if make is not valid
              
          }
          userMakeInput = canonicalMake; // Use the canonical make for further processing
      } else {
          userMakeInput = 'ANY'; // Set to 'ANY' for the query
      }
  
      if (location) {
        const yardId = convertLocationToYardId(location);
    
        try {
          let vehicles = await queryVehicles(yardId, userMakeInput, model, yearInput);
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
                  .setTitle(`Database search results for ${location} ${userMakeInput} ${model} (${yearInput})`)
                  .setTimestamp()
                  .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
      
              // Using fields to separate entries for better readability
              pageItems.forEach(v => {
                  const firstSeen = new Date(v.first_seen);
                  const lastUpdated = new Date(v.last_updated);
                  const firstSeenFormatted = `${firstSeen.getMonth() + 1}/${firstSeen.getDate()}`;
                  const lastUpdatedFormatted = `${lastUpdated.getMonth() + 1}/${lastUpdated.getDate()}`;
                  embed.addFields({
                      name: `${v.vehicle_make} ${v.vehicle_model} (${v.vehicle_year})`,
                      value: `Yard: ${yardId === 'ALL' || Array.isArray(yardId) ? v.yard_name : ''}, Row: ${v.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`,
                      inline: false // Setting inline to false ensures each vehicle entry is clearly separated.
                  });
              });
      
              return embed;
          };
      
          console.log(`\n\nAttempting to create a button with customId as save: ${interaction.user.id} ${interaction.user.tag} ${yardId}:${userMakeInput}:${model}:${yearInput}\n\n`)
          const status = 'Active';
      
          // Function to update the components based on the current page
          const updateComponents = (currentPage, userId) => new ActionRowBuilder()
          .addComponents(
              new ButtonBuilder()
                  .setCustomId(`previous:${userId}`)
                  .setLabel('Previous')
                  .setStyle(ButtonStyle.Primary)
                  .setDisabled(currentPage === 0),
              new ButtonBuilder()
                  .setCustomId(`next:${userId}`)
                  .setLabel('Next')
                  .setStyle(ButtonStyle.Primary)
                  .setDisabled(currentPage === totalPages - 1),
              new ButtonBuilder()
                  .setCustomId(`save:${yardId}:${userMakeInput}:${model}:${yearInput}:${status}:${userId}`)
                  .setLabel('Save Search')
                  .setStyle(ButtonStyle.Success)
          );
      
      
          const message = await interaction.reply({ embeds: [getPage(0)], components: [updateComponents(0, interaction.user.id)], fetchReply: true });


      
          const collector = message.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 120000 });

          
      
          collector.on('collect', async i => {
            const parts = i.customId.split(':');
            const action = parts[0];
            const userId = parts[parts.length - 1];  // User ID is always the last part of the customId
            const yardName = convertYardIdToLocation(yardId);
        
            // Ensure the action is initiated by the user who started the interaction
            if (userId !== i.user.id) {
                await i.reply({ content: "You do not have permission to perform this action.", ephemeral: true });
                return;
            }
        
            switch (action) {
                case 'next':
                case 'previous':
                    // Handle page navigation
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
        
                    console.log(`Attempting to save or check existing search: YardID=${yardId}, Make=${make}, Model=${model}, Year=${yearInput}`);
        
                    // Check if the search already exists
                    try {
                      const exists = await checkExistingSearch(i.user.id, yardId, userMakeInput, model, yearInput, 'Active');
                      if (!exists) {
                          await addSavedSearch(i.user.id, i.user.tag, yardId, yardName, userMakeInput, model, yearInput, 'Active', '');
                          await i.reply({ content: 'Search saved successfully!', ephemeral: true });
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
            // Optionally, you can clear the buttons after the collector expires if needed
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
    
  } else if (interaction.commandName === 'savedsearch') {
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
                        new ButtonBuilder().setCustomId(`prev:${currentIndex}:${userId}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === 0),
                        new ButtonBuilder().setCustomId(`next:${currentIndex}:${userId}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(currentIndex === savedSearches.length - 1),
                        new ButtonBuilder().setCustomId(`delete:${currentIndex}:${userId}`).setLabel('Delete').setStyle(ButtonStyle.Danger)
                    );
                
                

                return { embed, components };
            };

            const initialMessage = updateEmbedAndComponents(currentIndex);
            await interaction.reply({ embeds: [initialMessage.embed], components: [initialMessage.components] });

            const filter = i => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
              const [action, index, interactionUserId] = i.customId.split(':');
          
              if (interactionUserId !== i.user.id) {
                  await i.reply({ content: "You do not have permission to modify this saved search.", ephemeral: true });
                  return;
              }
          
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
          
          

            collector.on('end', () => {
                interaction.editReply({ components: [] }); // Optionally clear the buttons when the interaction ends
            });
        } else {
            await interaction.reply({ content: 'You have no saved searches matching the criteria.', ephemeral: true });
        }
    } catch (error) {
        console.error('Error retrieving saved searches:', error);
        await interaction.reply({ content: 'Failed to retrieve saved searches.', ephemeral: true });
    }
} else if (interaction.commandName === 'dailysavedsearch') {
    console.log('Daily saved search command received.');
    try { 
      await processDailySavedSearches();
      await interaction.reply('Daily saved searches processed successfully.');
    } catch (error) {
      console.error('Error processing daily saved searches:', error);
      await interaction.reply('An error occurred while processing daily saved searches.');
    }
  }



    // Button interaction for 'quit'
    if (interaction.isButton() && interaction.customId === 'quit') {
      if (messageCollector) {
        messageCollector.stop();
        messageCollector = null; // Reset the collector reference
      }
      await interaction.update({ content: 'Operation cancelled.', components: [] });
    }
  } catch (error) {
    console.error('Error processing interaction:', error);
    await interaction.reply('An error occurred while processing your request.');
  }
  });
  
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

    // Convert number to string if necessary
    if (typeof yardId === 'number') {
        yardId = yardId.toString();
        console.log("Converted number yardId to string:", yardId);
    }

    if (yardId.includes(',')) {
        const ids = yardId.split(',').map(id => id.trim());
        const yardNames = ids.map(id => {
            const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(id));
            console.log(`Mapping ${id} to ${yardKey}`); // Log each ID mapping
            return yardKey || 'Unknown Yard';
        });
        return yardNames.join(', ');
    } else {
        const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key].toString() === yardId.trim());
        console.log(`Single ID mapping: ${yardId} to ${yardKey}`); // Log single ID mapping
        return yardKey || 'Unknown Yard';  // Fallback if no matching key is found
    }
}










client.login(process.env.TOKEN);
