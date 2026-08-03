const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const {
  loadInitialInventoryPage,
  submitSearch,
} = require('../src/scraping/httpInventoryClient');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

const INVENTORY_FORM_HTML = `
  <form id="searchinventory" method="post" action="/">
    <select name="YardId"></select>
    <select name="VehicleMake"></select>
    <select name="VehicleModel"></select>
  </form>`;

test('HTTP inventory client rejects non-success pages before parsing them', async () => {
  const clientState = {
    cookieHeader: '',
    cheerio,
    httpClient: {
      async request() {
        return {
          status: 429,
          headers: {},
          data: INVENTORY_FORM_HTML,
        };
      },
    },
  };

  await assert.rejects(
    loadInitialInventoryPage(clientState, 'https://inventory.example/'),
    /Page request failed with status 429/
  );
});

test('HTTP inventory client rejects cross-origin form actions', async () => {
  const clientState = {
    cookieHeader: 'session=test-cookie',
    cheerio,
    httpClient: {
      async request() {
        return {
          status: 200,
          headers: {},
          data: `
            <form id="searchinventory" method="post" action="https://collector.example/steal">
              <input type="hidden" name="__RequestVerificationToken" value="test-token">
            </form>`,
        };
      },
    },
  };

  await assert.rejects(
    loadInitialInventoryPage(clientState, 'https://inventory.example/'),
    /form action must stay on the configured origin/
  );
});

test('HTTP inventory client rejects unsafe form methods', async () => {
  const clientState = {
    cookieHeader: '',
    cheerio,
    httpClient: {
      async request() {
        return {
          status: 200,
          headers: {},
          data: '<form id="searchinventory" method="delete" action="/"></form>',
        };
      },
    },
  };

  await assert.rejects(
    loadInitialInventoryPage(clientState, 'https://inventory.example/'),
    /form uses an unsupported method/
  );
});

test('HTTP scraper debug output does not include hidden form values', async () => {
  const previousDebugValue = process.env.SCRAPER_HTTP_DEBUG;
  process.env.SCRAPER_HTTP_DEBUG = 'true';
  const clientState = {
    cookieHeader: '',
    cheerio,
    httpClient: {
      async request() {
        return {
          status: 200,
          headers: {},
          data: INVENTORY_FORM_HTML,
        };
      },
    },
  };

  try {
    const consoleCalls = await captureConsole(() =>
      submitSearch(
        clientState,
        'https://inventory.example/',
        {
          method: 'POST',
          actionUrl: 'https://inventory.example/',
          hiddenInputs: {
            __RequestVerificationToken: 'sensitive-csrf-token',
          },
          fields: {
            yard: 'YardId',
            make: 'VehicleMake',
            model: 'VehicleModel',
          },
        },
        {
          yardId: 1020,
          make: 'TOYOTA',
          model: 'CAMRY',
          hasMultipleLocations: true,
        }
      )
    );
    const output = joinedConsoleText(consoleCalls);

    assert.match(output, /submitSearch payload prepared/);
    assert.equal(output.includes('sensitive-csrf-token'), false);
    assert.equal(output.includes('TOYOTA'), false);
    assert.equal(output.includes('CAMRY'), false);
  } finally {
    if (previousDebugValue === undefined) {
      delete process.env.SCRAPER_HTTP_DEBUG;
    } else {
      process.env.SCRAPER_HTTP_DEBUG = previousDebugValue;
    }
  }
});
