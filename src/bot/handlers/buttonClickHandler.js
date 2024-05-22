async function handleButtonClick(interaction, buttonId) {
    if (buttonId === 'quit') {
      if (messageCollector) {
        messageCollector.stop();
        messageCollector = null;
      }
      await interaction.update({ content: 'Operation cancelled.', components: [] });
    } else {
      // Handle other button clicks here
    }
  }
  
  module.exports = { handleButtonClick };
  