const { summarizeError } = require('../../utils/errorSummary');

async function handleButtonClick(interaction, buttonId, messageCollector = null) {
  if (buttonId.startsWith('sq:')) {
    try {
      const { handleSavedSearchQuickActionButton } = require('../commands/searchCommand');
      const quickHash = buttonId.slice(3);
      await handleSavedSearchQuickActionButton(interaction, quickHash);
    } catch (error) {
      console.error('Saved-search quick action failed:', summarizeError(error));
      const errorReply = {
        content: 'Unable to process that quick action.',
        ephemeral: true,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(errorReply);
      } else {
        await interaction.reply(errorReply);
      }
    }
    return;
  }

  if (buttonId === 'quit') {
    if (messageCollector && typeof messageCollector.stop === 'function') {
      messageCollector.stop();
    }
    await interaction.update({ content: 'Operation cancelled.', components: [] });
  }
}

module.exports = { handleButtonClick };
