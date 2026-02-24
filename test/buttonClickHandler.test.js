const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const handlerPath = path.join(repoRoot, 'src/bot/handlers/buttonClickHandler.js');

const { handleButtonClick } = require(handlerPath);

test('handleButtonClick quit updates interaction and stops collector when provided', async () => {
  let stopCalls = 0;
  const messageCollector = {
    stop() {
      stopCalls += 1;
    },
  };

  const updates = [];
  const interaction = {
    async update(payload) {
      updates.push(payload);
    },
  };

  await handleButtonClick(interaction, 'quit', messageCollector);

  assert.equal(stopCalls, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0].content, /operation cancelled/i);
  assert.deepEqual(updates[0].components, []);
});

test('handleButtonClick non-quit does nothing and does not throw', async () => {
  const interaction = {
    async update() {
      throw new Error('update should not be called');
    },
  };

  await handleButtonClick(interaction, 'some-other-button');
});
