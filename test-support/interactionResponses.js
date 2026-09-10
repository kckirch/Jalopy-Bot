const assert = require('node:assert/strict');

// Keep existing payload recorders, but enforce Discord's single acknowledgement.
function withInteractionResponses(interaction) {
  if (interaction.responseMethods) return interaction;
  const recordReply = interaction.reply?.bind(interaction) || (async () => {});
  const recordUpdate = interaction.update?.bind(interaction) || (async () => {});
  const recordModal = interaction.showModal?.bind(interaction) || (async () => {});
  interaction.responseMethods = [];
  interaction.deferred = false;
  interaction.replied = false;
  let updateDeferred = false;
  const acknowledge = (method) => {
    assert.equal(interaction.deferred || interaction.replied, false, 'interaction already acknowledged');
    interaction.responseMethods.push(method);
  };
  interaction.deferReply = async (options) => {
    acknowledge('deferReply');
    interaction.deferOptions = options;
    interaction.deferred = true;
  };
  interaction.deferUpdate = async () => {
    acknowledge('deferUpdate');
    interaction.deferred = true;
    updateDeferred = true;
  };
  interaction.reply = async (payload) => {
    acknowledge('reply');
    interaction.replied = true;
    return recordReply(payload);
  };
  interaction.update = async (payload) => {
    acknowledge('update');
    interaction.replied = true;
    return recordUpdate(payload);
  };
  interaction.showModal = async (payload) => {
    acknowledge('showModal');
    interaction.replied = true;
    return recordModal(payload);
  };
  interaction.editReply = async (payload) => {
    assert(interaction.deferred || interaction.replied, 'edit requires acknowledgement');
    interaction.responseMethods.push('editReply');
    return updateDeferred ? recordUpdate(payload) : recordReply(payload);
  };
  interaction.followUp = async (payload) => {
    assert(interaction.deferred || interaction.replied, 'followup requires acknowledgement');
    interaction.responseMethods.push('followUp');
    return recordReply(payload);
  };
  return interaction;
}

module.exports = { withInteractionResponses };
