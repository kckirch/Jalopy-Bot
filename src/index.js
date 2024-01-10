require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder } = require('discord.js');

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

    // Here you can call a function to perform the search and get results
    // For now, we'll just send back an embed with the user's input

    const searchEmbed = new EmbedBuilder()
      .setTitle('Search Parameters')
      .setDescription('Here are your search parameters:')
      .addFields(
        { name: 'Location', value: location },
        { name: 'Make', value: make },
        { name: 'Model', value: model }
      )
      .setColor('Orange');

    await interaction.reply({ embeds: [searchEmbed] });
  } 
});


client.login(process.env.TOKEN);