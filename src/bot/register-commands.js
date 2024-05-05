require('dotenv').config({ path: '../.env'});
const { REST, Routes, SlashCommandBuilder, ApplicationCommandOptionType } = require('discord.js');

// Create command builders
const searchCommand = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search for vehicles!')
  .addStringOption(option => 
    option.setName('location')
    .setDescription('The location to search in')
    .setRequired(true)
    .addChoices(
      { name: 'Boise', value: 'boise' },
      { name: 'Garden City', value: 'gardencity' },
      { name: 'Nampa', value: 'nampa' },
      { name: 'Caldwell', value: 'caldwell' },
      { name: 'Twin Falls', value: 'twinfalls' },
      { name: 'All', value: 'all' }
    ))
  .addStringOption(option => 
    option.setName('make')
    .setDescription('The make of the vehicle')
    .setRequired(false))
  .addStringOption(option => 
    option.setName('model')
    .setDescription('The model of the vehicle')
    .setRequired(false));

const dbSearchCommand = new SlashCommandBuilder()
  .setName('dbsearch')
  .setDescription('Search for vehicles in the database')
  .addStringOption(option => 
    option.setName('location')
    .setDescription('The yard location to search')
    .setRequired(true)
    .addChoices(
      { name: 'Boise', value: 'boise' },
      { name: 'Garden City', value: 'gardencity' },
      { name: 'Nampa', value: 'nampa' },
      { name: 'Caldwell', value: 'caldwell' },
      { name: 'Twin Falls', value: 'twinfalls' },
      { name: 'All', value: 'all' }
    ))
  .addStringOption(option => 
    option.setName('make')
    .setDescription('The make of the vehicle')
    .setRequired(false))
  .addStringOption(option => 
    option.setName('model')
    .setDescription('The model of the vehicle')
    .setRequired(false))
  .addStringOption(option =>
    option.setName('year')
    .setDescription('The year(s) of the vehicle (comma-separated list or range)')
    .setRequired(false));

const commands = [
  searchCommand.toJSON(),
  dbSearchCommand.toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Slash commands were registered successfully!');
  } catch (error) {
    console.log(`There was an error: ${error}`);
  }
})();
