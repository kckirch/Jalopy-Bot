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
        value: '`/search make:<make> model:<model> year:<optional> location:<optional>`\nLocation defaults to All. Use autocomplete, then Edit Search or a suggested spelling to fix input without retyping the command. The family/generation dropdown groups related models; BMW E9x/F3x presets are approximate model/year filters, not verified chassis.',
      },
      {
        name: '2) Save an Alert',
        value: '`Save Alert` keeps the filters shown in the response, including a selected family, even with no current matches. By default, you receive a daily DM with all matching available vehicles—not only new arrivals. Choose `status:New` for vehicles marked New. With no matches, try Any Year or All Locations before saving.',
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
