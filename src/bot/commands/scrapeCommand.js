// src/bot/commands/scrapeCommand.js

const { universalWebScrape } = require('../../scraping/universalWebScrape');
const { EmbedBuilder } = require('discord.js');
const { getSessionID } = require('../utils/utils');
const { convertLocationToYardId } = require('../utils/locationUtils');
const junkyards = require('../../config/junkyards');
const { withScrapeLock } = require('../../scraping/scrapeLock');
const { ensureElevatedCommandAccess } = require('../utils/commandPermissions');

// Helper function to scrape all junkyards
async function scrapeAllJunkyards(make, model, sessionID) {
  // Scrape Jalopy Jungle
  const jalopyConfig = junkyards['jalopyJungle'];
  const yardIds = Object.keys(jalopyConfig.locationMapping);

  for (const yardId of yardIds) {
    const options = {
      ...jalopyConfig,
      yardId: yardId,
      make: make,
      model: model,
      sessionID: sessionID,
      shouldMarkInactive: make === 'ANY' && model === 'ANY',
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
    shouldMarkInactive: make === 'ANY' && model === 'ANY',
  };

  console.log(`Starting web scrape for Trusty yard ID ${trustyConfig.yardId} with sessionID: ${sessionID}`);

  await universalWebScrape(trustyOptions);
}

async function handleScrapeCommand(interaction) {
  if (!(await ensureElevatedCommandAccess(interaction, 'scrape'))) {
    return;
  }

  let location = interaction.options.getString('location');
  let make = interaction.options.getString('make') || 'ANY';
  let model = interaction.options.getString('model') || 'ANY';

  const sessionID = getSessionID();
  console.log(`Session ID: ${sessionID}`);

  if (location) {
    make = make.toUpperCase();
    model = model.toUpperCase();

    const scrapeLabel = `manual:${interaction.user?.id || 'unknown'}:${location.toLowerCase()}:${sessionID}`;

    try {
      await withScrapeLock(scrapeLabel, async () => {
        if (location.toLowerCase() === 'all') {
          // Scrape all junkyards and all their locations
          await scrapeAllJunkyards(make, model, sessionID);

          const searchEmbed = new EmbedBuilder()
            .setTitle('Search Parameters')
            .setDescription('Scraped all junkyards.')
            .setColor('Orange');

          await interaction.reply({ embeds: [searchEmbed] });
          return;
        }

        // Scrape a specific location
        const yardId = convertLocationToYardId(location);
        if (!yardId) {
          await interaction.reply(`Unknown location: ${location}`);
          return;
        }

        const normalizedLocation = location.toLowerCase();
        const junkyardKey = normalizedLocation === 'trusty' || normalizedLocation === 'trustypickapart'
          ? 'trustyJunkyard'
          : 'jalopyJungle';
        const junkyardConfig = junkyards[junkyardKey];

        if (!junkyardConfig) {
          await interaction.reply(`Unknown junkyard for location: ${location}`);
          return;
        }

        // Determine the final yardId
        let finalYardId = junkyardConfig.hasMultipleLocations ? yardId : junkyardConfig.yardId;

        const options = {
          ...junkyardConfig,
          yardId: finalYardId,
          make: make,
          model: model,
          sessionID: sessionID,
          shouldMarkInactive: make === 'ANY' && model === 'ANY',
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
      });
    } catch (error) {
      if (error && error.code === 'SCRAPE_IN_PROGRESS') {
        const runningLabel = error.activeScrapeLabel ? ` (${error.activeScrapeLabel})` : '';
        await interaction.reply({
          content: `A scrape is already running${runningLabel}. Please wait for it to finish and try again.`,
          ephemeral: true,
        });
        return;
      }
      throw error;
    }
  } else {
    await interaction.reply('Please provide a location to scrape.');
  }
}

module.exports = { handleScrapeCommand };
