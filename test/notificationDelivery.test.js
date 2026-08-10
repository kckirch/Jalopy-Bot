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

test('user delivery rejects before fetch when the Discord client is not ready', async () => {
  let fetchCalled = false;
  await assert.rejects(
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
    ),
    /Discord client is not ready/
  );

  assert.equal(fetchCalled, false);
});

test('channel delivery rejects when a configured channel cannot be found', async () => {
  await assert.rejects(
    sendChannelNotification(
      {
        isReady: () => true,
        channels: {
          cache: { get: () => null },
          fetch: async () => null,
        },
      },
      '111111111111111111',
      [{}]
    ),
    /Notification channel not found/
  );
});

test('channel delivery fetches a channel that is not cached', async () => {
  const sends = [];
  let fetchedId;
  const channel = { send: async (payload) => sends.push(payload) };

  await sendChannelNotification(
    {
      isReady: () => true,
      channels: {
        cache: { get: () => null },
        fetch: async (id) => {
          fetchedId = id;
          return channel;
        },
      },
    },
    '111111111111111111',
    [{}]
  );

  assert.equal(fetchedId, '111111111111111111');
  assert.equal(sends.length, 1);
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

test('daily channel delivery skips embed parts already present in recent messages', async () => {
  const sends = [];
  const footerPrefix = 'Daily inventory 20260810';
  const embeds = [
    { footer: { text: `${footerPrefix} • part 1 of 2` } },
    { footer: { text: `${footerPrefix} • part 2 of 2` } },
  ];
  const channel = {
    messages: {
      fetch: async () => [
        { embeds: [{ footer: { text: `${footerPrefix} • part 1 of 2` } }] },
      ],
    },
    async send(payload) {
      sends.push(payload);
    },
  };

  const result = await sendChannelNotification(
    {
      isReady: () => true,
      channels: { cache: { get: () => channel } },
    },
    '111111111111111111',
    embeds,
    { dedupeFooterPrefix: footerPrefix }
  );

  assert.deepEqual(result, {
    embedsSent: 1,
    messagesSent: 1,
    skippedEmbeds: 1,
  });
  assert.deepEqual(sends[0].embeds, [embeds[1]]);
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

  assert.match(output, /Failed to deliver user notification: TypeError/);
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
