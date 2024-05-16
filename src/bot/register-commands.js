require('dotenv').config({ path: '../.env'});
const { REST, Routes, SlashCommandBuilder, ApplicationCommandOptionType } = require('discord.js');

// Create command builders
const scrapeCommand = new SlashCommandBuilder()
  .setName('scrape')
  .setDescription('Scrape the website for DB data!')
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

const searchCommand = new SlashCommandBuilder()
  .setName('search')
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
      { name: 'Treasure Valley Yards', value: 'treasurevalleyyards' },
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
    .setRequired(false))
  .addStringOption(option =>
    option.setName('status')
    .setDescription('The status of the vehicle | New, Active, or Inactive')
    .addChoices(
      { name: 'New', value: 'NEW' },
      { name: 'Active (Includes New)', value: 'ACTIVE' },
      { name: 'Inactive', value: 'INACTIVE' }
    )
    .setRequired(false));


const savedSearchCommand = new SlashCommandBuilder()
  .setName('savedsearch')
  .setDescription('Save a search for automatic daily updates')
  .addStringOption(option => 
    option.setName('location')
    .setDescription('The yard location to search')
    .setRequired(false)
    .addChoices(
      { name: 'Boise', value: 'boise' },
      { name: 'Garden City', value: 'gardencity' },
      { name: 'Nampa', value: 'nampa' },
      { name: 'Caldwell', value: 'caldwell' },
      { name: 'Twin Falls', value: 'twinfalls' },
      { name: 'Treasure Valley Yards', value: 'treasurevalleyyards' },
      { name: 'All', value: 'all' }
    ));

const dailySearchCommand = new SlashCommandBuilder()
  .setName('dailysavedsearch')
  .setDescription('Enable or disable daily saved searches')

const runTestScheduler = new SlashCommandBuilder()
  .setName('runtestscheduler')
  .setDescription('Run the test scheduler')

const commandsCommand = new SlashCommandBuilder()
.setName('commands')
.setDescription('Showcase all user commands with examples');

const commands = [
  scrapeCommand.toJSON(),
  searchCommand.toJSON(),
  savedSearchCommand.toJSON(),
  dailySearchCommand.toJSON(),
  runTestScheduler.toJSON(),
  commandsCommand.toJSON()
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
