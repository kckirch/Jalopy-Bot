const { EmbedBuilder } = require('discord.js');
const junkyards = require('../../config/junkyards');
const { YARDS } = require('../../config/yards');
const {
  formatScrapeLogValue,
  formatScrapeYardId,
} = require('../../scraping/scrapeLogging');
const { withScrapeLock } = require('../../scraping/scrapeLock');
const { universalWebScrape } = require('../../scraping/universalWebScrape');
const { getSessionID } = require('../../utils/sessionId');
const { ensureElevatedCommandAccess } = require('../utils/commandPermissions');

function createScrapeOptions(junkyardConfig, yardId, parameters) {
  const { make, model, sessionID } = parameters;
  return {
    ...junkyardConfig,
    yardId,
    make,
    model,
    sessionID,
    shouldMarkInactive: make === 'ANY' && model === 'ANY',
  };
}

async function scrapeConfiguredYard(
  junkyardConfig,
  yardId,
  parameters,
  scrape
) {
  console.log(`[scrape] Starting manual yard=${formatScrapeYardId(yardId)}`);
  await scrape(createScrapeOptions(junkyardConfig, yardId, parameters));
}

function getConfiguredYardIds(junkyardConfig) {
  if (junkyardConfig.hasMultipleLocations) {
    return Object.keys(junkyardConfig.locationMapping);
  }
  return [junkyardConfig.yardId];
}

async function scrapeAllJunkyards(parameters, scrape) {
  for (const junkyardConfig of Object.values(junkyards)) {
    for (const yardId of getConfiguredYardIds(junkyardConfig)) {
      await scrapeConfiguredYard(junkyardConfig, yardId, parameters, scrape);
    }
  }
}

function resolveScrapeTarget(location) {
  const normalizedLocation = String(location).trim().toLowerCase();
  const yard = YARDS.find(({ slug }) => slug === normalizedLocation);
  if (!yard) {
    return null;
  }

  const junkyardConfig = junkyards[yard.junkyardKey];
  if (!junkyardConfig) {
    return null;
  }

  return {
    junkyardConfig,
    yardId: junkyardConfig.hasMultipleLocations
      ? yard.id
      : junkyardConfig.yardId,
  };
}

function createCompletionEmbed({ location, make, model, sessionID }) {
  const isAllLocations = location.toLowerCase() === 'all';
  const fields = [
    { name: 'Make', value: make, inline: true },
    { name: 'Model', value: model, inline: true },
    { name: 'Session ID', value: sessionID, inline: true },
  ];
  if (!isAllLocations) {
    fields.unshift({ name: 'Location', value: location, inline: true });
  }

  return new EmbedBuilder()
    .setTitle('Scrape Complete')
    .setDescription(
      isAllLocations
        ? 'Finished scraping all configured junkyards.'
        : 'Scrape finished with these parameters:'
    )
    .addFields(...fields)
    .setColor('Orange');
}

async function executeManualScrape(parameters, scrape) {
  const { location } = parameters;
  if (location.toLowerCase() === 'all') {
    await scrapeAllJunkyards(parameters, scrape);
    return { embeds: [createCompletionEmbed(parameters)] };
  }

  const target = resolveScrapeTarget(location);
  if (!target) {
    return { content: `Unknown location: ${location}` };
  }

  await scrapeConfiguredYard(
    target.junkyardConfig,
    target.yardId,
    parameters,
    scrape
  );
  return { embeds: [createCompletionEmbed(parameters)] };
}

function createBusyScrapeMessage(error) {
  const runningLabel = error.activeScrapeLabel
    ? ` (${error.activeScrapeLabel})`
    : '';
  return `A scrape is already running${runningLabel}. Please wait for it to finish and try again.`;
}

async function handleScrapeCommand(
  interaction,
  {
    scrape = universalWebScrape,
    getSession = getSessionID,
    runWithLock = withScrapeLock,
  } = {}
) {
  if (!(await ensureElevatedCommandAccess(interaction, 'scrape'))) {
    return;
  }

  const location = interaction.options.getString('location');
  if (!location) {
    await interaction.reply('Please provide a location to scrape.');
    return;
  }

  const parameters = {
    location,
    make: (interaction.options.getString('make') || 'ANY').toUpperCase(),
    model: (interaction.options.getString('model') || 'ANY').toUpperCase(),
    sessionID: getSession(),
  };
  await interaction.deferReply({ ephemeral: true });

  const scrapeLabel = `manual:${formatScrapeLogValue(
    location.toLowerCase(),
    { maxLength: 32 }
  )}:${parameters.sessionID}`;

  try {
    await runWithLock(scrapeLabel, async () => {
      const response = await executeManualScrape(parameters, scrape);
      await interaction.editReply(response);
    });
  } catch (error) {
    if (error?.code !== 'SCRAPE_IN_PROGRESS') {
      throw error;
    }
    await interaction.editReply({ content: createBusyScrapeMessage(error) });
  }
}

module.exports = { handleScrapeCommand };
