//index.js



require('dotenv').config({ path: '../.env'});




const { webScrape } = require('../scraping/jalopyScraper');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle, Client, IntentsBitField, EmbedBuilder } = require('discord.js');

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
    let location = interaction.options.getString('location') || 'Any';
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
    const normalizedLocation = location.toUpperCase().replace(/\s/g, '');
    return yardIdMapping[normalizedLocation];
  }





client.login(process.env.TOKEN);