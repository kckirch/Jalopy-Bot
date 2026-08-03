const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sendChannelNotification,
  sendUserNotification,
} = require('../src/notifications/notificationDelivery');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

test('user delivery skips fetch when the Discord client is not ready', async () => {
  let fetchCalled = false;
  const consoleCalls = await captureConsole(() =>
    sendUserNotification(
      {
        isReady: () => false,
        users: {
          fetch: async () => {
            fetchCalled = true;
          },
        },
      },
      'user-1',
      [{}]
    )
  );

  assert.equal(fetchCalled, false);
  assert.match(joinedConsoleText(consoleCalls), /Discord client is not ready/);
});

test('channel delivery reports a missing configured channel', async () => {
  const consoleCalls = await captureConsole(() =>
    sendChannelNotification(
      {
        isReady: () => true,
        channels: { cache: { get: () => null } },
      },
      '111111111111111111',
      [{}]
    )
  );

  assert.match(joinedConsoleText(consoleCalls), /Notification channel not found/);
});

test('delivery splits messages after ten embeds', async () => {
  const sends = [];
  const channel = {
    async send(payload) {
      sends.push(payload);
    },
  };

  await sendChannelNotification(
    {
      isReady: () => true,
      channels: { cache: { get: () => channel } },
    },
    '111111111111111111',
    Array.from({ length: 11 }, (_value, index) => ({ index }))
  );

  assert.deepEqual(
    sends.map((payload) => payload.embeds.length),
    [10, 1]
  );
});

test('delivery starts a new message before exceeding payload size', async () => {
  const sends = [];
  const channel = {
    async send(payload) {
      sends.push(payload);
    },
  };
  const embeds = [
    { description: 'a'.repeat(3500) },
    { description: 'b'.repeat(3500) },
  ];

  await sendChannelNotification(
    {
      isReady: () => true,
      channels: { cache: { get: () => channel } },
    },
    '111111111111111111',
    embeds
  );

  assert.deepEqual(
    sends.map((payload) => payload.embeds.length),
    [1, 1]
  );
});

test('user lookup failures are redacted and remain observable', async () => {
  const privateDetails = '/home/private/users.db user=123';
  const error = new TypeError(privateDetails);

  const consoleCalls = await captureConsole(() =>
    assert.rejects(
      sendUserNotification(
        {
          isReady: () => true,
          users: {
            fetch: async () => {
              throw error;
            },
          },
        },
        'user-1',
        [{}]
      ),
      (caughtError) => caughtError === error
    )
  );
  const output = joinedConsoleText(consoleCalls);

  assert.match(output, /Failed to fetch notification recipient: TypeError/);
  assert.equal(output.includes(privateDetails), false);
});

test('send failures are redacted and remain observable', async () => {
  const privateDetails = 'private Discord payload 123';
  const error = new RangeError(privateDetails);
  const channel = {
    async send() {
      throw error;
    },
  };

  const consoleCalls = await captureConsole(() =>
    assert.rejects(
      sendChannelNotification(
        {
          isReady: () => true,
          channels: { cache: { get: () => channel } },
        },
        '111111111111111111',
        [{}]
      ),
      (caughtError) => caughtError === error
    )
  );
  const output = joinedConsoleText(consoleCalls);

  assert.match(output, /Failed to send notification: RangeError/);
  assert.equal(output.includes(privateDetails), false);
});
