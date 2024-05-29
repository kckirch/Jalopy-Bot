const { notifyNewVehicles } = require('../../notifications/dailyTasks');

async function handleManualNotifyNewVehiclesCommand(interaction) {
  try {
    if (!interaction.member.roles.cache.some(role => role.name === 'Admin')) {
      await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      return;
    }

    await notifyNewVehicles();
    await interaction.reply({ content: 'New vehicles notification sent successfully.', ephemeral: true });
  } catch (error) {
    console.error('Error notifying new vehicles:', error);
    await interaction.reply({ content: 'Failed to send new vehicles notification.', ephemeral: true });
  }
}

module.exports = { handleManualNotifyNewVehiclesCommand };
