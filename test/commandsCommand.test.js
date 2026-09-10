const test = require('node:test');
const assert = require('node:assert/strict');

const { handleCommandsCommand } = require('../src/bot/commands/commandsCommand');

test('commands command replies with the public command guide', async () => {
  const replies = [];
  const interaction = {
    async reply(payload) {
      replies.push(payload);
    },
  };

  await handleCommandsCommand(interaction);

  assert.equal(replies.length, 1);
  assert.equal(replies[0].ephemeral, true);
  assert.equal(replies[0].embeds.length, 1);

  const embed = replies[0].embeds[0].toJSON();
  assert.equal(embed.title, 'Jalopy Bot Command Guide');
  assert.deepEqual(
    embed.fields.map((field) => field.name),
    [
      '1) Search Inventory',
      '2) Save an Alert',
      '3) Manage Alerts Privately',
      'Tip',
    ]
  );
});
