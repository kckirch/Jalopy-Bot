const { notifyNewVehicles } = require('../../notifications/dailyTasks');
const { ensureElevatedCommandAccess } = require('../utils/commandPermissions');

async function handleManualNotifyNewVehiclesCommand(interaction) {
  try {
    if (!(await ensureElevatedCommandAccess(interaction, 'manualnotifynewvehicles'))) {
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
