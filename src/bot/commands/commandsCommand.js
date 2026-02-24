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
        value: '`/search location:<yard/group> make:<optional> model:<optional> year:<optional> status:<optional>`\nUse autocomplete for make/model.',
      },
      {
        name: '2) Use Result Buttons',
        value: '`Previous` / `Next` page\n`Save Search` to track matches\n`Delete Saved` to remove current filter\n`My Saved Searches` for DM summary\nLocation dropdown reruns same filters in another yard',
      },
      {
        name: '3) Manage Saved Searches',
        value: '`/savedsearch` opens an in-channel carousel:\n`Prev Saved`, `Next Saved`, `Run`, `Delete`, and `Pause Alerts`',
      },
      {
        name: 'Tip',
        value: 'Searches run against the bot database, so normal users only need `/search` and `/savedsearch`.',
      }
    );

  await interaction.reply({ embeds: [guideEmbed], ephemeral: true });
}

module.exports = { handleCommandsCommand };
