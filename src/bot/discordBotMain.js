/**
 * discordBotMain.js
 * 
 * Main entry point for a Discord bot that manages interactions for vehicle inventory searches and updates.
 * This bot handles commands from Discord users to initiate searches based on yard, make, and model criteria,
 * scraping vehicle data from the Jalopy Jungle website and querying from a local database.
 * 
 * Key Features:
 * - Set up the database and initialize connection.
 * - Handle 'search' and 'dbsearch' commands to fetch vehicle data either by scraping online or querying the database.
 * - Utilizes Discord.js for bot interactions, creating interactive messages with buttons and handling user input.
 * 
 * Dependencies:
 * - dotenv for environment variable management.
 * - Discord.js for handling interactions with the Discord API.
 * - vehicleQueryManager and vehicleDbInventoryManager for database operations.
 * - jalopyJungleScraper for web scraping functionality.
 */




require('dotenv').config({ path: '../.env'});

const { queryVehicles } = require('../database/vehicleQueryManager');



const { webScrape } = require('../scraping/jalopyJungleScraper');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle, Client, IntentsBitField, EmbedBuilder } = require('discord.js');

const { setupDatabase, insertVehicle } = require('../database/vehicleDbInventoryManager');

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









function createRow(currentPage, maxPages) {
  return new ActionRowBuilder()
      .addComponents(
          new ButtonBuilder()
              .setCustomId('previous')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === 0),
          new ButtonBuilder()
              .setCustomId('next')
              .setLabel('Next')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(currentPage === maxPages - 1)
      );
}



const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

// Global reference for the message collector
let messageCollector = null;

client.on('ready', (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
});

client.on('interactionCreate', async (interaction) => {
  // Command interaction for 'search'
  if (interaction.isChatInputCommand() && interaction.commandName === 'search') {
    let location = interaction.options.getString('location');
    let make = interaction.options.getString('make') || 'Any';
    let model = interaction.options.getString('model') || 'Any';

    if (location && make) {
      make = make.toUpperCase();
      model = model.toUpperCase();
      const yardId = convertLocationToYardId(location);

      // Call the webScrape function with the parameters
      webScrape(yardId, make, model);
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
              .setDescription('Here are your search parameters:')
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
    } else if (interaction.commandName === 'dbsearch') {
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

          console.log(`   🚗 Canonical Make Found: ${canonicalMake}`);
  
          if (!vehicleMakes.includes(canonicalMake)) {
              // If the canonical make is not recognized, inform the user and list available options
              const makesEmbed = new EmbedBuilder()
                  .setColor(0x0099FF) // Set a visually appealing color
                  .setTitle('Available Vehicle Makes')
                  .setDescription('The make you entered is not recognized. Please choose from the list below.')
                  .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });
  
              await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
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
                if (firstSeenB - firstSeenA !== 0) {
                    return firstSeenB - firstSeenA;  // Sort by first_seen descending
                }
                return a.vehicle_model.localeCompare(b.vehicle_model);  // Alphabetically by model
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
                    .setTitle(`Database search results for ${location} ${userMakeInput} ${model}`)
                    .setTimestamp()
                    .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
    
                // Using fields to separate entries for better readability
                pageItems.forEach(v => {
                    const firstSeen = new Date(v.first_seen);
                    const lastUpdated = new Date(v.last_updated);
                    const firstSeenFormatted = `${firstSeen.getMonth() + 1}/${firstSeen.getDate()}`;
                    const lastUpdatedFormatted = `${lastUpdated.getMonth() + 1}/${lastUpdated.getDate()}`;
                    //if the yard id is 'ALL' then we need to include the yard name in the embed
                    if (yardId === 'ALL') {
                      embed.addFields({
                          name: `${v.vehicle_make} ${v.vehicle_model} (${v.vehicle_year})`,
                          value: `Yard: ${v.yard_name}, Row: ${v.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`,
                          inline: false // Setting inline to false ensures each vehicle entry is clearly separated.
                      });
                    } else {

                      embed.addFields({ 
                          name: `${v.vehicle_make} ${v.vehicle_model} (${v.vehicle_year})`,
                          value: `Row: ${v.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`,
                          inline: false // Setting inline to false ensures each vehicle entry is clearly separated.
                      });
                    }
                });
    
                return embed;
            };
    
            // Function to update the components based on the current page
            const updateComponents = (currentPage) => new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('previous')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId('next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === totalPages - 1)
                );
    
            const message = await interaction.reply({ embeds: [getPage(0)], components: [updateComponents(0)], fetchReply: true });
    
            const filter = i => i.user.id === interaction.user.id;
            const collector = message.createMessageComponentCollector({ filter, time: 120000 });
    
            collector.on('collect', async i => {
                if (i.customId === 'previous' && currentPage > 0) {
                    currentPage--;
                } else if (i.customId === 'next' && currentPage < totalPages - 1) {
                    currentPage++;
                }
    
                await i.update({ embeds: [getPage(currentPage)], components: [updateComponents(currentPage)] });
            });
    
            collector.on('end', () => {
                message.edit({ components: [] }); // Remove the buttons after the collector ends
            });
        } catch (error) {
            console.error('Error querying vehicles:', error);
            await interaction.reply({ content: 'Error fetching data from the database.', ephemeral: true });
        }
    } else {
        await interaction.reply({ content: 'Location is required for this search.', ephemeral: true });
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
  });
  
  function convertLocationToYardId(location) {
    if (location.toUpperCase() === 'ALL') {
      return 'ALL';
    }
    const normalizedLocation = location.toUpperCase().replace(/\s/g, '');
    return yardIdMapping[normalizedLocation] || 'ALL';
  }





client.login(process.env.TOKEN);