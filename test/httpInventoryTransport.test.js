const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHttpClientState,
  requestJson,
  requestPage,
} = require('../src/scraping/httpInventoryTransport');

test('HTTP transport uses an injected client without loading axios', () => {
  const httpClient = { request() {} };
  const cheerio = { load() {} };
  const state = createHttpClientState({
    httpClient,
    cheerio,
    loadAxios() {
      throw new Error('axios should not be loaded');
    },
  });

  assert.equal(state.httpClient, httpClient);
  assert.equal(state.cheerio, cheerio);
  assert.equal(state.cookieHeader, '');
});

test('HTTP transport carries cookies across page requests', async () => {
  const requests = [];
  const responses = [
    {
      status: 200,
      headers: { 'Set-Cookie': ['session=new; Path=/', 'theme=dark'] },
      data: '<html>first</html>',
    },
    {
      status: 200,
      headers: { 'set-cookie': 'session=updated; Path=/' },
      data: '<html>second</html>',
    },
  ];
  const clientState = {
    cookieHeader: 'existing=value',
    httpClient: {
      async request(config) {
        requests.push(config);
        return responses.shift();
      },
    },
  };

  const firstPage = await requestPage(clientState, {
    method: 'GET',
    url: 'https://inventory.example/',
    payload: { yard: '1020' },
  });
  const secondPage = await requestPage(clientState, {
    method: 'POST',
    url: 'https://inventory.example/',
    payload: { make: 'TOYOTA' },
  });

  assert.equal(firstPage, '<html>first</html>');
  assert.equal(secondPage, '<html>second</html>');
  assert.equal(requests[0].headers.Cookie, 'existing=value');
  assert.deepEqual(requests[0].params, { yard: '1020' });
  assert.equal(
    requests[1].headers.Cookie,
    'existing=value; session=new; theme=dark'
  );
  assert.equal(
    requests[1].headers['Content-Type'],
    'application/x-www-form-urlencoded'
  );
  assert.equal(requests[1].data, 'make=TOYOTA');
  assert.equal(
    clientState.cookieHeader,
    'existing=value; session=updated; theme=dark'
  );
});

test('HTTP transport treats malformed JSON as a soft lookup failure', async () => {
  const runState = { hadSoftFailure: false };
  const clientState = {
    cookieHeader: '',
    httpClient: {
      async request() {
        return {
          status: 200,
          headers: {},
          data: '{not-json',
        };
      },
    },
  };

  const data = await requestJson(clientState, {
    url: 'https://inventory.example/Home/GetModels',
    payload: { makeName: 'TOYOTA' },
    runState,
  });

  assert.deepEqual(data, []);
  assert.equal(runState.hadSoftFailure, true);
});

test('HTTP transport rejects unsuccessful JSON responses as soft failures', async () => {
  const runState = { hadSoftFailure: false };
  const clientState = {
    cookieHeader: '',
    httpClient: {
      async request() {
        return { status: 503, headers: {}, data: [] };
      },
    },
  };

  await assert.rejects(
    requestJson(clientState, {
      url: 'https://inventory.example/Home/GetMakes',
      payload: { yardId: '1020' },
      runState,
    }),
    /JSON request failed with status 503/
  );
  assert.equal(runState.hadSoftFailure, true);
});
