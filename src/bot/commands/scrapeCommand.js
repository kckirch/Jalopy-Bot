// src/bot/commands/scrapeCommand.js

const { universalWebScrape } = require('../../scraping/universalWebScrape');
const { EmbedBuilder } = require('discord.js');
const { getSessionID } = require('../utils/utils');
const { vehicleMakes, convertLocationToYardId } = require('../utils/locationUtils');
const junkyards = require('../../config/junkyards');

async function handleScrapeCommand(interaction) {
  let location = interaction.options.getString('location');
  let make = interaction.options.getString('make') || 'ANY';
  let model = interaction.options.getString('model') || 'ANY';

  const sessionID = getSessionID();
  console.log(`Session ID: ${sessionID}`);

  if (location) {
    make = make.toUpperCase();
    model = model.toUpperCase();

    if (location === 'all') {
      // Scrape all junkyards and all their locations
      await scrapeAllJunkyards(make, model, sessionID);

      const searchEmbed = new EmbedBuilder()
        .setTitle('Search Parameters')
        .setDescription('Scraped all junkyards.')
        .setColor('Orange');

      await interaction.reply({ embeds: [searchEmbed] });
    } else {
      // Scrape a specific location
      const yardId = convertLocationToYardId(location); // Get the specific yard ID for the location
      if (!yardId) {
        await interaction.reply(`Unknown location: ${location}`);
        return;
      }

      const junkyardKey = location === 'trusty' ? 'trustyJunkyard' : 'jalopyJungle'; // Determine junkyard key
      const junkyardConfig = junkyards[junkyardKey];

      if (!junkyardConfig) {
        await interaction.reply(`Unknown junkyard for location: ${location}`);
        return;
      }

      // Handle yardId based on whether it's a multi-location yard
      let finalYardId = yardId;
      if (junkyardConfig.hasMultipleLocations) {
        // For multiple-location junkyards, the yardId is the specific yardId
        finalYardId = yardId;
      } else {
        // For single-location junkyards, use the configured yardId
        finalYardId = junkyardConfig.yardId;
      }

      const options = {
        ...junkyardConfig,
        yardId: finalYardId,
        make: make,
        model: model,
        sessionID: sessionID,
      };

      console.log(`Starting web scrape for yard ID ${finalYardId} with sessionID: ${sessionID}`);

      await universalWebScrape(options);

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
  } else {
    await interaction.reply('Please provide a location to scrape.');
  }
}

module.exports = { handleScrapeCommand };

// Helper function to scrape all junkyards
async function scrapeAllJunkyards(make, model, sessionID) {
  // Scrape Jalopy Jungle
  const jalopyConfig = junkyards['jalopyJungle'];
  for (const yardId in jalopyConfig.locationMapping) {
    const options = {
      ...jalopyConfig,
      yardId: yardId,
      make: make,
      model: model,
      sessionID: sessionID,
    };

    console.log(`Starting web scrape for Jalopy Jungle yard ID ${yardId} with sessionID: ${sessionID}`);

    await universalWebScrape(options);
  }

  // Scrape Trusty
  const trustyConfig = junkyards['trustyJunkyard'];
  const trustyOptions = {
    ...trustyConfig,
    yardId: trustyConfig.yardId,
    make: make,
    model: model,
    sessionID: sessionID,
  };

  console.log(`Starting web scrape for Trusty yard ID ${trustyConfig.yardId} with sessionID: ${sessionID}`);

  await universalWebScrape(trustyOptions);
}
