const test = require('node:test');
const assert = require('node:assert/strict');
const { Events } = require('discord.js');

const { client } = require('../src/bot/utils/client');

test('Discord client registers supported connection lifecycle listeners', () => {
  const eventNames = new Set(client.eventNames());
  const websocketError = new Error('websocket failure');
  const shardError = new Error('shard failure');
  const errorCalls = [];
  const warningCalls = [];
  const logCalls = [];
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;

  assert.equal(eventNames.has(Events.Error), true);
  assert.equal(eventNames.has(Events.ShardError), true);
  assert.equal(eventNames.has(Events.ShardDisconnect), true);
  assert.equal(eventNames.has(Events.ShardReconnecting), true);
  assert.equal(eventNames.has('disconnect'), false);
  assert.equal(eventNames.has('reconnecting'), false);

  try {
    console.error = (...args) => errorCalls.push(args);
    console.warn = (...args) => warningCalls.push(args);
    console.log = (...args) => logCalls.push(args);

    client.emit(Events.Error, websocketError);
    client.emit(Events.ShardError, shardError);
    client.emit(Events.ShardDisconnect, { code: 1006 }, 3);
    client.emit(Events.ShardReconnecting, 3);
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
  }

  assert.deepEqual(errorCalls, [
    ['WebSocket encountered an error:', websocketError],
    ['A websocket connection encountered an error:', shardError],
  ]);
  assert.deepEqual(warningCalls, [['Shard 3 disconnected with code 1006.']]);
  assert.deepEqual(logCalls, [['Shard 3 is attempting to reconnect.']]);
});
