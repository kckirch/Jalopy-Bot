const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHttpClientState,
  requestJson,
  requestPage,
} = require('../src/scraping/httpInventoryTransport');

function response(status, body, cookies = []) {
  return {
    status,
    headers: { getSetCookie: () => cookies },
    text: async () => body,
  };
}

test('HTTP transport defaults to the installed parser and native fetch', () => {
  const state = createHttpClientState();

  assert.equal(state.cheerio, require('cheerio'));
  assert.equal(state.fetch, globalThis.fetch);
  assert.equal(state.cheerio.load('<p>inventory</p>')('p').text(), 'inventory');
  assert.equal(state.cookieHeader, '');
});

test('HTTP transport uses an injected native fetch', () => {
  const fetch = async () => response(200, '');
  const cheerio = { load() {} };
  const state = createHttpClientState({ fetch, cheerio });

  assert.equal(state.fetch, fetch);
  assert.equal(state.cheerio, cheerio);
  assert.equal(state.cookieHeader, '');
});

test('HTTP transport carries cookies across native fetch requests', async () => {
  const requests = [];
  const responses = [
    response(200, '<html>first</html>', [
      'session=new; Path=/',
      'theme=dark',
    ]),
    response(200, '<html>second</html>', ['session=updated; Path=/']),
  ];
  const clientState = {
    cookieHeader: 'existing=value',
    async fetch(url, options) {
      requests.push({ url, options });
      return responses.shift();
    },
  };

  assert.equal(await requestPage(clientState, {
    method: 'GET',
    url: 'https://inventory.example/',
    payload: { yard: '1020' },
  }), '<html>first</html>');
  assert.equal(await requestPage(clientState, {
    method: 'POST',
    url: 'https://inventory.example/',
    payload: { make: 'TOYOTA' },
  }), '<html>second</html>');

  assert.equal(requests[0].url.searchParams.get('yard'), '1020');
  assert.equal(requests[0].options.headers.Cookie, 'existing=value');
  assert.equal(
    requests[1].options.headers.Cookie,
    'existing=value; session=new; theme=dark'
  );
  assert.equal(
    requests[1].options.headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  assert.equal(requests[1].options.body, 'make=TOYOTA');
  assert.equal(
    clientState.cookieHeader,
    'existing=value; session=updated; theme=dark'
  );
});

test('HTTP transport treats malformed JSON as a soft lookup failure', async () => {
  const runState = { hadSoftFailure: false };
  const data = await requestJson({
    cookieHeader: '',
    fetch: async () => response(200, '{not-json'),
  }, {
    url: 'https://inventory.example/Home/GetModels',
    payload: { makeName: 'TOYOTA' },
    runState,
  });

  assert.deepEqual(data, []);
  assert.equal(runState.hadSoftFailure, true);
});

test('HTTP transport rejects unsuccessful JSON responses as soft failures', async () => {
  const runState = { hadSoftFailure: false };
  await assert.rejects(
    requestJson({
      cookieHeader: '',
      fetch: async () => response(503, '[]'),
    }, {
      url: 'https://inventory.example/Home/GetMakes',
      payload: { yardId: '1020' },
      runState,
    }),
    /JSON request failed with status 503/
  );
  assert.equal(runState.hadSoftFailure, true);
});
