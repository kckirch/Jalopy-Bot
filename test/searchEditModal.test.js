const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: tick } = require('node:timers/promises');
const { Client, Events, InteractionType, Message } = require('discord.js');
const { attachSearchInteractionCollector } = require('../src/bot/handlers/searchInteractionCollector');
const { createSearchState } = require('../src/bot/handlers/searchState');
const { withInteractionResponses } = require('../test-support/interactionResponses');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const initialCriteria = { make: 'TOYOTA', model: 'CAMRY', yearRange: '2005', status: 'ACTIVE' };
let interactionId = 0;

function interaction(client, customId, properties = {}) {
  return withInteractionResponses({
    client, customId, id: String(++interactionId), type: InteractionType.MessageComponent,
    user: { id: 'owner', tag: 'tester' }, message: { id: 'search-message' },
    channelId: 'testing', guildId: null, replies: [], updates: [], modals: [],
    async reply(payload) { this.replies.push(payload); },
    async update(payload) { this.updates.push(payload); },
    async showModal(modal) { this.modals.push(modal.toJSON()); },
    ...properties,
  });
}

async function createSession(t, criteria = initialCriteria) {
  const client = new Client({ intents: [] });
  const queryCalls = [];
  const saves = [];
  const dependencies = {
    queryVehicles: async (...args) => { queryCalls.push(args); return []; },
    getModelSuggestionsForNoResults: async () => [],
    checkExistingSearch: async () => false,
    addSavedSearch: async (...args) => saves.push(args),
  };
  const message = {
    client, id: 'search-message', channelId: 'testing', guildId: null, edits: [],
    createMessageComponentCollector: Message.prototype.createMessageComponentCollector,
    async edit(payload) { this.edits.push(payload); },
  };
  const initialSearchState = await createSearchState('boise', criteria, dependencies);
  const collector = attachSearchInteractionCollector({ message, ownerId: 'owner', initialSearchState, criteria }, dependencies);
  t.after(async () => { collector.stop(); await client.destroy(); });
  const send = async (input) => { client.emit(Events.InteractionCreate, input); await tick(); return input; };
  const click = (action, properties) => send(interaction(client, `search:${action}`, properties));
  return { client, collector, dependencies, queryCalls, saves, message, send, click };
}

function submit(session, modal, fields, properties) {
  return session.send(interaction(session.client, modal.custom_id, {
    type: InteractionType.ModalSubmit,
    fields: { getTextInputValue: (id) => fields[id] ?? '' },
    ...properties,
  }));
}

function modalValues(modal) {
  return Object.fromEntries(modal.components.map(({ components: [field] }) => [field.custom_id, field.value]));
}

test('native edit dialog is prefilled, private to its owner and nonce, and saves the rendered edit', async (t) => {
  const session = await createSession(t);
  const opened = await session.click('edit');
  const modal = opened.modals[0];
  assert.deepEqual(opened.responseMethods, ['showModal']);
  assert.deepEqual(modalValues(modal), { make: 'TOYOTA', model: 'CAMRY', year: '2005', status: 'ACTIVE' });
  assert.match(modal.custom_id, /^search:edit:[a-f0-9-]+$/);
  assert.equal(session.client.listenerCount(Events.InteractionCreate), 2);
  const outsider = await submit(session, modal, {}, { user: { id: 'other' } });
  const wrongNonce = await submit(session, { custom_id: 'search:edit:wrong' }, {});
  assert.deepEqual(outsider.responseMethods, []);
  assert.deepEqual(wrongNonce.responseMethods, []);
  // A dialog left open must not block normal controls or become stale after paging.
  assert.deepEqual((await session.click('next')).responseMethods, ['update']);
  const edited = await submit(session, modal, { make: ' vw ', model: ' golf ', year: ' 2008-2010 ', status: ' new ' });
  assert.deepEqual(edited.responseMethods, ['deferUpdate', 'editReply']);
  assert.deepEqual(session.queryCalls.at(-1), [1020, 'VOLKSWAGEN', 'GOLF', '2008-2010', 'NEW']);
  assert.match(edited.updates[0].embeds[0].data.description, /Location: boise/);
  assert.equal(session.client.listenerCount(Events.InteractionCreate), 1);
  await session.click('save');
  assert.deepEqual(session.saves[0].slice(2, 8), ['1020', 'BOISE', 'VOLKSWAGEN', 'GOLF', '2008-2010', 'NEW']);
});

test('invalid edits stay recoverable and cannot query inventory or save an alert', async (t) => {
  const session = await createSession(t, { ...initialCriteria, make: 'TOYTA' });
  assert.deepEqual(session.queryCalls, []);
  for (const invalid of [
    { make: 'TOYOTA', model: 'CAMRY', year: '2011-2006', status: 'ACTIVE' },
    { make: 'TOYOTA', model: 'CAMRY', year: '2005', status: 'EVERYTHING' },
    { make: 'TOYOTA', model: 'FAMILY: 3 SERIES', year: '2005', status: 'ACTIVE' },
  ]) {
    const opened = await session.click('edit');
    const edited = await submit(session, opened.modals[0], invalid);
    assert.equal(edited.updates[0].embeds[0].data.title, 'Let’s fix this search');
    const save = await session.click('save');
    assert.match(save.replies[0].content, /Fix the highlighted/);
    assert.deepEqual(session.saves, []);
    assert.deepEqual(session.queryCalls, []);
  }
  const opened = await session.click('edit');
  const fixed = await submit(session, opened.modals[0], { make: ' toyota ', model: ' ', year: ' ', status: '' });
  assert.deepEqual(session.queryCalls, [[1020, 'TOYOTA', 'ANY', 'ANY', 'ACTIVE']]);
  assert.match(fixed.updates[0].embeds[0].data.title, /TOYOTA ANY/);
  await session.click('save');
  assert.deepEqual(session.saves[0].slice(4, 8), ['TOYOTA', 'ANY', 'ANY', 'ACTIVE']);
});

test('a dialog opened before a filter change cannot overwrite the newer search', async (t) => {
  const session = await createSession(t);
  const opened = await session.click('edit');
  await session.click('relocate', { values: ['all'] });
  const queryCount = session.queryCalls.length;
  const stale = await submit(session, opened.modals[0], { make: 'BMW', model: 'ANY' });
  assert.deepEqual(stale.responseMethods, ['reply']);
  assert.equal(stale.replies[0].ephemeral, true);
  assert.match(stale.replies[0].content, /changed or expired/);
  assert.equal(session.queryCalls.length, queryCount);
  await session.click('save');
  assert.equal(session.saves[0][2], '1020,1021,1022,1099,1119,999999');
  assert.deepEqual(session.saves[0].slice(4, 8), ['TOYOTA', 'CAMRY', '2005', 'ACTIVE']);
});

test('reopening and expiry remove pending native modal collectors', async (t) => {
  const session = await createSession(t);
  const first = await session.click('edit');
  const second = await session.click('edit');
  assert.notEqual(first.modals[0].custom_id, second.modals[0].custom_id);
  assert.equal(session.client.listenerCount(Events.InteractionCreate), 2);
  const old = await submit(session, first.modals[0], {});
  assert.deepEqual(old.responseMethods, []);
  session.collector.stop('time');
  await tick();
  assert.equal(session.client.listenerCount(Events.InteractionCreate), 0);
  assert.deepEqual(session.message.edits.at(-1).components, []);
  const expired = await submit(session, second.modals[0], {});
  assert.deepEqual(expired.responseMethods, []);
  assert.deepEqual(session.saves, []);
});

test('failed modal opening or rendering keeps the existing filters and redacts errors', async (t) => {
  const session = await createSession(t);
  const logs = await captureConsole(async () => {
    const failedOpen = await session.click('edit', { showModal: async () => { throw new Error('private-token'); } });
    assert.equal(session.client.listenerCount(Events.InteractionCreate), 1);
    assert.match(failedOpen.replies[0].content, /error occurred/);
    const opened = await session.click('edit');
    const failedEdit = await submit(session, opened.modals[0], { make: 'BMW', model: 'ANY' }, {
      update: async () => { throw new Error('private-token'); },
    });
    assert.deepEqual(failedEdit.responseMethods, ['deferUpdate', 'editReply', 'followUp']);
    assert.match(failedEdit.replies[0].content, /error occurred/);
  });
  assert.equal(joinedConsoleText(logs).includes('private-token'), false);
  await session.click('save');
  assert.deepEqual(session.saves[0].slice(4, 8), ['TOYOTA', 'CAMRY', '2005', 'ACTIVE']);
});

test('saving during a pending modal edit is refused, then uses only the completed response', async (t) => {
  const session = await createSession(t);
  const opened = await session.click('edit');
  let finishQuery;
  session.dependencies.queryVehicles = () => new Promise((resolve) => { finishQuery = resolve; });
  const editing = await submit(session, opened.modals[0], { make: 'BMW', model: 'ANY' });
  assert.deepEqual(editing.responseMethods, ['deferUpdate']);
  const busy = await session.click('save');
  assert.match(busy.replies[0].content, /previous action/);
  assert.deepEqual(session.saves, []);
  finishQuery([]);
  await tick();
  assert.deepEqual(editing.responseMethods, ['deferUpdate', 'editReply']);
  await session.click('save');
  assert.deepEqual(session.saves[0].slice(4, 8), ['BMW', 'ANY', 'ANY', 'ACTIVE']);
});
