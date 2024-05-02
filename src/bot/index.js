//index.js



require('dotenv').config({ path: '../.env'});

const { queryVehicles } = require('../database/vehicleDbManager');



const { webScrape } = require('../scraping/jalopyScraper');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ButtonStyle, Client, IntentsBitField, EmbedBuilder } = require('discord.js');

const { setupDatabase, insertVehicle } = require('../database/inventoryDb');

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
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 
  'Chevrolet', 'Chrysler', 'Dodge', 'Ford', 'Geo', 
  'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Isuzu', 
  'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 
  'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mercury', 'Mitsubishi', 
  'Nissan', 'Oldsmobile', 'Plymouth', 'Pontiac', 'Porsche', 
  'Saab', 'Saturn', 'Scion', 'Subaru', 'Suzuki', 
  'Toyota', 'Volkswagen', 'Volvo'
];

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
      let make = interaction.options.getString('make') || 'Any';
      let model = interaction.options.getString('model') || 'Any';
  
      console.log('🔍 DB Lookup for:');
      console.log(`   🏞️ Location: ${location}`);
      console.log(`   🚗 Make: ${make}`);
      console.log(`   📋 Model: ${model}`);
  
      if (location) {  // Check to ensure 'location' is provided
          make = make.toUpperCase();  // Normalize inputs
          model = model.toUpperCase();
          const yardId = convertLocationToYardId(location);  // Convert location to a yard ID
  
          try {
              const vehicles = await queryVehicles(yardId, make, model);  // Query the database
  
              if (vehicles.length > 0) {
                  const resultsEmbed = new EmbedBuilder()
                      .setColor(0x0099FF) // Sets a blue color for the embed
                      .setTitle(`Database search results for ${location} ${make} ${model}`)
                      .setDescription('Here are the vehicles found:')
                      .setTimestamp();
  
                  vehicles.forEach(v => {
                      const firstSeenDate = new Date(v.first_seen);
                      const formattedFirstSeen = `${firstSeenDate.getMonth() + 1}/${firstSeenDate.getDate()}`;
                      const formattedLastUpdated = `${new Date(v.last_updated).getMonth() + 1}/${new Date(v.last_updated).getDate()}`;
  
                      resultsEmbed.addFields({
                          name: `${v.vehicle_make} ${v.vehicle_model} (${v.vehicle_year})`,
                          value: `Row: ${v.row_number}, First Seen: ${formattedFirstSeen}, Last Updated: ${formattedLastUpdated}`,
                          inline: false // Set to false for better readability; set to true if you prefer a compact layout
                      });
                  });
  
                  await interaction.reply({ embeds: [resultsEmbed] });
              } else {
                  await interaction.reply('No vehicles found.');
              }
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