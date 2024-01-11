//index.js

require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder } = require('discord.js');



const vehicleMakes = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 
  'Chevrolet', 'Chrysler', 'Dodge', 'Ford', 'Geo', 
  'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Isuzu', 
  'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 
  'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mercury', 'Mitsubishi', 
  'Nissan', 'Oldsmobile', 'Plymouth', 'Pontiac', 'Porsche', 
  'Saab', 'Saturn', 'Scion', 'Subaru', 'Suzuki', 
  'Toyota', 'Volkswagen', 'Volvo'
].join(', ');



const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

client.on('ready', (c) => {
  console.log(`✅   ${c.user.tag} is online.  ✅`);
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
  
    if (interaction.commandName === 'search') {
      const location = interaction.options.getString('location');
      const make = interaction.options.getString('make');
      const model = interaction.options.getString('model');
  
      if (location && !make) {
        // Send an embed with a list of makes and prompt for a reply
        const makesEmbed = new EmbedBuilder()
          .setTitle('Available Vehicle Makes in ' + location)
          .setDescription('Please reply with the make of the vehicle you are interested in.')
          .addFields({ name: 'Makes', value: vehicleMakes })
          .setColor('Orange');
  
        await interaction.reply({ embeds: [makesEmbed] });
  
        // Set up a collector or listener for the next message from this user
        const filter = m => m.author.id === interaction.user.id;
        const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
  
        collector.on('collect', async m => {
          try {
            console.log(`Collected make: ${m.content}`);
            const makeInput = m.content.toLowerCase();
          
            // Check if the make is in the list
            if (!vehicleMakes.includes(makeInput)) {
              await m.reply(`"${makeInput}" is not a valid make. Please choose from the list.`);
              return; // Stop further processing
            }
          
            // If valid, continue with your logic
            await interaction.followUp(`You have selected Location: ${location} and Make: ${makeInput}.`);
          
            // Proceed with next steps...
          } catch (error) {
            console.error('Error handling collected make:', error);
            await m.reply('An error occurred while processing your request.');
          }
        });
  
        collector.on('end', collected => {
          if (collected.size === 0) {
            interaction.followUp('No make was provided.');
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
  });
  


client.login(process.env.TOKEN);