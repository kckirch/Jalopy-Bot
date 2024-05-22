const { webScrape } = require('../../scraping/jalopyJungleScraper');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSessionID } = require('../utils/utils');
const { vehicleMakes, convertLocationToYardId } = require('../utils/locationUtils');  // Import the function

async function handleScrapeCommand(interaction) {
  let location = interaction.options.getString('location');
  let make = interaction.options.getString('make') || 'Any';
  let model = interaction.options.getString('model') || 'Any';

  const sessionID = getSessionID();
  console.log(`Session ID: ${sessionID}`);

  if (location && make) {
    make = make.toUpperCase();
    model = model.toUpperCase();
    const yardId = convertLocationToYardId(location);

    console.log(`Starting web scrape with sessionID: ${sessionID}`);

    webScrape(yardId, make, model, sessionID);
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
          const resultEmbed = new EmbedBuilder()
            .setTitle('Search Parameters')
            .setDescription('Here are your scrape search parameters:')
            .addFields(
              { name: 'Location', value: location },
              { name: 'Make', value: m.content },
              { name: 'Model', value: 'Any' }
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
  }
}

module.exports = { handleScrapeCommand };
