// commandEmbeds.js
const { EmbedBuilder } = require('discord.js');

// Create the embed for /search command
const searchEmbed = new EmbedBuilder()
  .setColor(0x0099FF)
  .setTitle('/search Command')
  .setDescription('Search for vehicles in the database.')
  .addFields(
    { name: 'Usage', value: '`/search <location> [make] [model] [year] [status]`' },
    { name: 'location (required)', value: 'The yard location to search.\nOptions: `Boise`, `Garden City`, `Nampa`, `Caldwell`, `Twin Falls`, `Treasure Valley Yards`, `All`' },
    { name: 'make (optional)', value: 'The make of the vehicle.' },
    { name: 'model (optional)', value: 'The model of the vehicle.' },
    { name: 'year (optional)', value: 'The year(s) of the vehicle (comma-separated list or range).' },
    { name: 'status (optional)', value: 'The status of the vehicle.\nOptions: `New`, `Active (Includes New)`, `Inactive`' },
    { name: 'Examples', value: 
      '**Search by location only:**\n' +
      '`/search location:boise`\n' +
      'This command will return all vehicles in the Boise yard.\n\n' +
      '**Search by location and make:**\n' +
      '`/search location:boise make:toyota`\n' +
      'This command will return all Toyota vehicles in the Boise yard.\n\n' +
      '**Search by location, make, and model:**\n' +
      '`/search location:boise make:toyota model:corolla`\n' +
      'This command will return all Toyota Corolla vehicles in the Boise yard.\n\n' +
      '**Search by location, make, model, and year:**\n' +
      '`/search location:boise make:toyota model:corolla year:2020`\n' +
      'This command will return all 2020 Toyota Corolla vehicles in the Boise yard.\n\n' +
      '**Search by location, make, model, year, and status:**\n' +
      '`/search location:boise make:toyota model:corolla year:2020 status:New`\n' +
      'This command will return all 2020 Toyota Corolla vehicles in the Boise yard that are New for the day.'
    }
  );

// Create the embed for /savedsearch command
const savedSearchEmbed = new EmbedBuilder()
  .setColor(0x0099FF)
  .setTitle('/savedsearch Command')
  .setDescription('Return your saved search preferences. Navigate through your saved searches with the previous and next buttons. Delete searches with the delete button.')
  .addFields(
    { name: 'Usage', value: '`/savedsearch [location]`' },
    { name: 'location (optional)', value: 'The yard location to search.\nOptions: `Boise`, `Garden City`, `Nampa`, `Caldwell`, `Twin Falls`, `Treasure Valley Yards`, `All`' },
    { name: 'Examples', value: 
        '**Return saved searches for any locations:**\n' +
        '`/savedsearch`\n' +
    'This command will return your saved searches for vehicles across all yards.\n\n' +
      '**Return saved searches for a specific location:**\n' +
      '`/savedsearch location:boise`\n' +
      'This command will return your saved searches for vehicles in the Boise yard.' 

    }
  );

// Create the embed for admin commands
const adminCommandsEmbed = new EmbedBuilder()
  .setColor(0xFF0000)
  .setTitle('Admin Commands')
  .setDescription('These commands are restricted to administrators.')
  .addFields(
    { name: '/scrape', value: 'Scrape the website for database data.' },
    { name: '/dailysavedsearch', value: 'Enable or disable daily saved searches.' },
    { name: '/runtestscheduler', value: 'Run the test scheduler.' }
  );

module.exports = { searchEmbed, savedSearchEmbed, adminCommandsEmbed };
