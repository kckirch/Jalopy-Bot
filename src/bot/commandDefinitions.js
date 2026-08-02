const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const {
  ALL_LOCATION_CHOICE,
  SEARCH_LOCATION_CHOICES,
  TREASURE_VALLEY_CHOICE,
  YARD_LOCATION_CHOICES,
} = require('./locationChoices');

function buildScrapeCommand() {
  return new SlashCommandBuilder()
    .setName('scrape')
    .setDescription('Scrape the website for DB data!')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) => option
      .setName('location')
      .setDescription('The location to search in')
      .setRequired(true)
      .addChoices(...YARD_LOCATION_CHOICES, ALL_LOCATION_CHOICE))
    .addStringOption((option) => option
      .setName('make')
      .setDescription('The make of the vehicle')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('model')
      .setDescription('The model of the vehicle')
      .setRequired(false)
      .setAutocomplete(true));
}

function buildSearchCommand() {
  return new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for vehicles in the database')
    .addStringOption((option) => option
      .setName('location')
      .setDescription('The yard location to search')
      .setRequired(true)
      .addChoices(...SEARCH_LOCATION_CHOICES))
    .addStringOption((option) => option
      .setName('make')
      .setDescription('The make of the vehicle')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('model')
      .setDescription('The model of the vehicle')
      .setRequired(false)
      .setAutocomplete(true))
    .addStringOption((option) => option
      .setName('year')
      .setDescription('The year(s) of the vehicle (comma-separated list or range)')
      .setRequired(false))
    .addStringOption((option) => option
      .setName('status')
      .setDescription('The status of the vehicle | New, Active, or Inactive')
      .addChoices(
        { name: 'New', value: 'NEW' },
        { name: 'Active (Includes New)', value: 'ACTIVE' },
        { name: 'Inactive', value: 'INACTIVE' }
      )
      .setRequired(false));
}

function buildSavedSearchCommand() {
  return new SlashCommandBuilder()
    .setName('savedsearch')
    .setDescription('Send Your Saved Searches to Your DMs!')
    .addStringOption((option) => option
      .setName('location')
      .setDescription('The yard location to search')
      .setRequired(false)
      .addChoices(...SEARCH_LOCATION_CHOICES));
}

function buildCommandDefinitions() {
  return [
    buildScrapeCommand(),
    buildSearchCommand(),
    buildSavedSearchCommand(),
    new SlashCommandBuilder()
      .setName('dailysavedsearch')
      .setDescription('Manually Force a daily saved searches to send to users')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('runtestscheduler')
      .setDescription('Run missed morning job: scrape yards, then send saved-search and new-car alerts')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
      .setName('commands')
      .setDescription('Showcase all user commands with examples'),
    new SlashCommandBuilder()
      .setName('manualnotifynewvehicles')
      .setDescription('Manually notify users of new vehicles')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  ].map((command) => command.toJSON());
}

module.exports = {
  ALL_LOCATION_CHOICE,
  SEARCH_LOCATION_CHOICES,
  TREASURE_VALLEY_CHOICE,
  YARD_LOCATION_CHOICES,
  buildCommandDefinitions,
};
