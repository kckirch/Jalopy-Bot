async function handleButtonClick(interaction, buttonId, messageCollector = null) {
    if (buttonId.startsWith('sq:')) {
      try {
        const { handleSavedSearchQuickActionButton } = require('../commands/searchCommand');
        const quickHash = buttonId.slice(3);
        await handleSavedSearchQuickActionButton(interaction, quickHash);
      } catch (error) {
        console.error('Saved-search quick action failed:', error);
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: 'Unable to process that quick action.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'Unable to process that quick action.', ephemeral: true });
        }
      }
      return;
    }

    if (buttonId === 'quit') {
      if (messageCollector && typeof messageCollector.stop === 'function') {
        messageCollector.stop();
      }
      await interaction.update({ content: 'Operation cancelled.', components: [] });
      return;
    }
}

module.exports = { handleButtonClick };
  
