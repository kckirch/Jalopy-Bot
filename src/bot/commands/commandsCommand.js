const { searchEmbed, savedSearchEmbed } = require('../../testing/commandEmbeds');

async function handleCommandsCommand(interaction) {
  console.log('Commands showcase command received.');
  await interaction.reply({ embeds: [searchEmbed, savedSearchEmbed] });
}

module.exports = { handleCommandsCommand };
