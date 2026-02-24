const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const scrapeModulePath = path.join(repoRoot, 'src/scraping/httpInventoryScrape.js');
const { scrapeWithHttp } = require(scrapeModulePath);
const cheerio = require('cheerio');

function buildInventoryHtml({
  yardOptions = ['1020'],
  makeOptions = [],
  modelOptions = [],
  rows = [],
} = {}) {
  const yardOptionHtml = ['<option value="">Select Location</option>', ...yardOptions.map((yardId) => `<option value="${yardId}">${yardId}</option>`)].join('');
  const makeOptionHtml = ['<option value="">Select Make</option>', ...makeOptions.map((value) => `<option value="${value}">${value}</option>`)].join('');
  const modelOptionHtml = ['<option value="">Select Model</option>', ...modelOptions.map((value) => `<option value="${value}">${value}</option>`)].join('');
  const rowHtml = rows.map((row) => `
    <tr>
      <td>${row.year}</td>
      <td>${row.make}</td>
      <td>${row.model}</td>
      <td>${row.rowNumber}</td>
    </tr>
  `).join('');

  return `
    <html>
      <body>
        <form action="/" enctype="multipart/form-data" id="searchinventory" method="post">
          <select class="form-control" id="yard-id" name="YardId">${yardOptionHtml}</select>
          <select class="form-control" id="car-make" name="VehicleMake">${makeOptionHtml}</select>
          <select class="form-control" id="car-model" name="VehicleModel">${modelOptionHtml}</select>
          <input type="submit" value="SEARCH" class="btn btn-primary">
        </form>
        <div class="table-responsive">
          <table class="table">
            <tbody>
              <tr>
                <th>YEAR</th>
                <th>MAKE</th>
                <th>MODEL</th>
                <th>ROW</th>
              </tr>
              ${rowHtml}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function parsePayload(config) {
  if (typeof config.data === 'string') {
    return Object.fromEntries(new URLSearchParams(config.data).entries());
  }
  if (config.params && typeof config.params === 'object') {
    return config.params;
  }
  return {};
}

function createHttpClient(handler) {
  return {
    async request(config) {
      return handler(config);
    },
  };
}

test('http scraper follows dynamic makes/models flow for ANY/ANY and reconciles inactive rows when rows were upserted', async () => {
  const upserts = [];
  const markCalls = [];

  const rowsByKey = new Map([
    ['TOYOTA|CAMRY', [{ year: 2005, make: 'TOYOTA', model: 'CAMRY', rowNumber: 11 }]],
    ['TOYOTA|COROLLA', [{ year: 2006, make: 'TOYOTA', model: 'COROLLA', rowNumber: 12 }]],
    ['HONDA|CIVIC', [{ year: 2007, make: 'HONDA', model: 'CIVIC', rowNumber: 13 }]],
  ]);

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA', 'HONDA'] }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetMakes') {
      assert.equal(payload.yardId, '1020');
      return {
        status: 200,
        headers: {},
        data: [{ makeName: 'TOYOTA' }, { makeName: 'HONDA' }],
      };
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      if (payload.makeName === 'TOYOTA') {
        return {
          status: 200,
          headers: {},
          data: [{ model: 'CAMRY' }, { model: 'COROLLA' }],
        };
      }
      if (payload.makeName === 'HONDA') {
        return {
          status: 200,
          headers: {},
          data: [{ model: 'CIVIC' }],
        };
      }
      return { status: 200, headers: {}, data: [] };
    }

    if (method === 'POST' && pathname === '/') {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const rows = rowsByKey.get(`${make}|${model}`) || [];
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], rows }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: '1020',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(upserts.length, 3);
  assert.deepEqual(
    upserts.map((args) => ({ make: args[1], model: args[2], year: args[3], row: args[4] })),
    [
      { make: 'TOYOTA', model: 'CAMRY', year: 2005, row: 11 },
      { make: 'TOYOTA', model: 'COROLLA', year: 2006, row: 12 },
      { make: 'HONDA', model: 'CIVIC', year: 2007, row: 13 },
    ]
  );
  assert.equal(markCalls.length, 1);
  assert.equal(markCalls[0].sessionID, '20260224');
  assert.deepEqual(markCalls[0].options, { yardIds: [1020] });
});

test('http scraper skips inactive reconciliation when zero rows were upserted', async () => {
  const markCalls = [];

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA'] }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetMakes') {
      return { status: 200, headers: {}, data: [{ makeName: 'TOYOTA' }] };
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      return { status: 200, headers: {}, data: [{ model: 'CAMRY' }] };
    }

    if (method === 'POST' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], rows: [] }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: '1020',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async () => {},
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(markCalls.length, 0);
});

test('http scraper in multi-yard mode iterates discovered yard options', async () => {
  const upserts = [];
  const markCalls = [];

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020', '1021'], makeOptions: ['TOYOTA'], modelOptions: ['CAMRY'] }),
      };
    }

    if (method === 'POST' && pathname === '/') {
      const yardId = String(payload.YardId || '').trim();
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const rows = make === 'TOYOTA' && model === 'CAMRY'
        ? [{ year: 2010, make: 'TOYOTA', model: 'CAMRY', rowNumber: yardId === '1020' ? 10 : 20 }]
        : [];
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020', '1021'], rows }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: null,
      make: 'TOYOTA',
      model: 'CAMRY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(upserts.length, 2);
  assert.deepEqual(upserts.map((args) => Number(args[0])).sort((a, b) => a - b), [1020, 1021]);
  assert.equal(markCalls.length, 1);
  assert.deepEqual(markCalls[0].options, { yardIds: [1020, 1021] });
});

test('http scraper single-location mode uses form make options and trusty model lookup payload', async () => {
  const upserts = [];
  const markCalls = [];
  let getMakesCalled = false;

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({
          yardOptions: ['999999'],
          makeOptions: ['TOYOTA'],
          modelOptions: ['CAMRY'],
        }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetMakes') {
      getMakesCalled = true;
      throw new Error('single-location scrape should not call GetMakes');
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      assert.equal(payload.makeName, 'TOYOTA');
      assert.equal(payload.showInventory, 'true');
      assert.equal(payload.yardId, undefined);
      return { status: 200, headers: {}, data: [{ model: 'CAMRY' }] };
    }

    if (method === 'POST' && pathname === '/') {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const rows = make === 'TOYOTA' && model === 'CAMRY'
        ? [{ year: 2012, make: 'TOYOTA', model: 'CAMRY', rowNumber: 44 }]
        : [];
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['999999'], makeOptions: ['TOYOTA'], rows }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.trustypickapart.com/',
      hasMultipleLocations: false,
      yardId: '999999',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(getMakesCalled, false);
  assert.equal(upserts.length, 1);
  assert.deepEqual(
    upserts.map((args) => ({ yardId: Number(args[0]), make: args[1], model: args[2], year: args[3], row: args[4] })),
    [{ yardId: 999999, make: 'TOYOTA', model: 'CAMRY', year: 2012, row: 44 }]
  );
  assert.equal(markCalls.length, 1);
  assert.deepEqual(markCalls[0].options, { yardIds: [999999] });
});

test('http scraper falls back to make options from HTML when GetMakes endpoint fails', async () => {
  const upserts = [];
  let getMakesAttempts = 0;

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA'], modelOptions: ['CAMRY'] }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetMakes') {
      getMakesAttempts += 1;
      throw new Error('simulated GetMakes failure');
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      throw new Error('simulated GetModels failure');
    }

    if (method === 'POST' && pathname === '/') {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const rows = make === 'TOYOTA'
        ? [{ year: 2008, make: 'TOYOTA', model: 'CAMRY', rowNumber: 31 }]
        : [];
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA'], rows }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: '1020',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: false,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async () => {},
    }
  );

  assert.equal(getMakesAttempts, 1);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][1], 'TOYOTA');
  assert.equal(upserts[0][2], 'CAMRY');
});

test('http scraper processes duplicate source rows without crashing and still reconciles scoped inactive rows', async () => {
  const upserts = [];
  const markCalls = [];

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA'] }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetMakes') {
      return { status: 200, headers: {}, data: [{ makeName: 'TOYOTA' }] };
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      return { status: 200, headers: {}, data: [{ model: 'CAMRY' }] };
    }

    if (method === 'POST' && pathname === '/') {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();
      const rows = make === 'TOYOTA' && model === 'CAMRY'
        ? [
          { year: 2003, make: 'TOYOTA', model: 'CAMRY', rowNumber: 50 },
          { year: 2003, make: 'TOYOTA', model: 'CAMRY', rowNumber: 50 },
        ]
        : [];
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], rows }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: '1020',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(upserts.length, 2);
  assert.deepEqual(
    upserts.map((args) => ({ make: args[1], model: args[2], year: args[3], row: args[4] })),
    [
      { make: 'TOYOTA', model: 'CAMRY', year: 2003, row: 50 },
      { make: 'TOYOTA', model: 'CAMRY', year: 2003, row: 50 },
    ]
  );
  assert.equal(markCalls.length, 1);
  assert.deepEqual(markCalls[0].options, { yardIds: [1020] });
});

test('http scraper continues across makes when one make model lookup fails and skips inactive reconciliation', async () => {
  const upserts = [];
  const markCalls = [];

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA', 'HONDA'] }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetMakes') {
      return {
        status: 200,
        headers: {},
        data: [{ makeName: 'TOYOTA' }, { makeName: 'HONDA' }],
      };
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      if (String(payload.makeName || '').toUpperCase() === 'TOYOTA') {
        throw new Error('simulated TOYOTA model endpoint failure');
      }
      if (String(payload.makeName || '').toUpperCase() === 'HONDA') {
        return { status: 200, headers: {}, data: [{ model: 'CIVIC' }] };
      }
      return { status: 200, headers: {}, data: [] };
    }

    if (method === 'POST' && pathname === '/') {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();

      let rows = [];
      if (make === 'TOYOTA' && model === '') {
        rows = [{ year: 2008, make: 'TOYOTA', model: 'CAMRY', rowNumber: 31 }];
      } else if (make === 'HONDA' && model === 'CIVIC') {
        rows = [{ year: 2009, make: 'HONDA', model: 'CIVIC', rowNumber: 32 }];
      }

      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], rows }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await scrapeWithHttp(
    {
      inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
      hasMultipleLocations: true,
      yardId: '1020',
      make: 'ANY',
      model: 'ANY',
      sessionID: '20260224',
      shouldMarkInactive: true,
    },
    {
      cheerio,
      httpClient,
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    }
  );

  assert.equal(upserts.length, 2);
  assert.deepEqual(
    upserts.map((args) => ({ make: args[1], model: args[2], year: args[3], row: args[4] })),
    [
      { make: 'TOYOTA', model: 'CAMRY', year: 2008, row: 31 },
      { make: 'HONDA', model: 'CIVIC', year: 2009, row: 32 },
    ]
  );
  assert.equal(markCalls.length, 0);
});

test('http scraper skips inactive reconciliation when scrape fails after partial upserts', async () => {
  const upserts = [];
  const markCalls = [];

  const httpClient = createHttpClient(async (config) => {
    const method = String(config.method || 'GET').toUpperCase();
    const pathname = new URL(config.url).pathname;
    const payload = parsePayload(config);

    if (method === 'GET' && pathname === '/') {
      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], makeOptions: ['TOYOTA'] }),
      };
    }

    if (method === 'POST' && pathname === '/Home/GetModels') {
      return { status: 200, headers: {}, data: [{ model: 'CAMRY' }, { model: 'COROLLA' }] };
    }

    if (method === 'POST' && pathname === '/') {
      const make = String(payload.VehicleMake || '').trim().toUpperCase();
      const model = String(payload.VehicleModel || '').trim().toUpperCase();

      if (make === 'TOYOTA' && model === 'CAMRY') {
        return {
          status: 200,
          headers: {},
          data: buildInventoryHtml({
            yardOptions: ['1020'],
            rows: [{ year: 2011, make: 'TOYOTA', model: 'CAMRY', rowNumber: 42 }],
          }),
        };
      }

      if (make === 'TOYOTA' && model === 'COROLLA') {
        throw new Error('simulated COROLLA scrape failure');
      }

      return {
        status: 200,
        headers: {},
        data: buildInventoryHtml({ yardOptions: ['1020'], rows: [] }),
      };
    }

    throw new Error(`Unexpected request: ${method} ${pathname}`);
  });

  await assert.rejects(
    scrapeWithHttp(
      {
        inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
        hasMultipleLocations: true,
        yardId: '1020',
        make: 'TOYOTA',
        model: 'ANY',
        sessionID: '20260224',
        shouldMarkInactive: true,
      },
      {
        cheerio,
        httpClient,
        insertOrUpdateVehicle: async (...args) => {
          upserts.push(args);
        },
        markInactiveVehicles: async (sessionID, options) => {
          markCalls.push({ sessionID, options });
        },
      }
    ),
    /simulated COROLLA scrape failure/
  );

  assert.equal(upserts.length, 1);
  assert.equal(markCalls.length, 0);
});
