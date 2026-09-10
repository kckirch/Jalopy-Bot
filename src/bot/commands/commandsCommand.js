const { EmbedBuilder } = require('discord.js');

async function handleCommandsCommand(interaction) {
  console.log('Commands showcase command received.');
  const guideEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('Jalopy Bot Command Guide')
    .setDescription('Fastest workflow with minimal typing:')
    .addFields(
      {
        name: '1) Search Inventory',
        value: '`/search make:<make> model:<model> year:<optional> location:<optional>`\nLocation defaults to All. Use make/model autocomplete; choose a make to include its model-family variants.',
      },
      {
        name: '2) Save an Alert',
        value: '`Save Alert` keeps these filters, even with no current matches. By default, you receive a daily DM with all matching available vehicles—not only new arrivals. Choose `status:New` for vehicles marked New. Use the model suggestion dropdown to correct a typo before saving.',
      },
      {
        name: '3) Manage Alerts Privately',
        value: '`Manage Alerts` or `/savedsearch` opens a private in-channel manager. Run a search, pause/resume alerts, test DMs, or remove an alert after confirming. No inventory is deleted.',
      },
      {
        name: 'Tip',
        value: 'Allow DMs from server members to receive alerts. Controls expire after two minutes; reopen `/search` or `/savedsearch` without losing saved alerts.',
      }
    );

  await interaction.reply({ embeds: [guideEmbed], ephemeral: true });
}

module.exports = { handleCommandsCommand };
