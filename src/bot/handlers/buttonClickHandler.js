async function handleButtonClick(interaction, buttonId, messageCollector = null) {
    if (buttonId === 'quit') {
      if (messageCollector && typeof messageCollector.stop === 'function') {
        messageCollector.stop();
      }
      await interaction.update({ content: 'Operation cancelled.', components: [] });
      return;
    }
}

module.exports = { handleButtonClick };
  
