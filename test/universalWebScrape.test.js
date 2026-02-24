const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const scrapePath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const seleniumScrapePath = path.join(repoRoot, 'src/scraping/seleniumInventoryScrape.js');
const managerPath = path.join(repoRoot, 'src/database/vehicleDbInventoryManager.js');
const seleniumPath = require.resolve('selenium-webdriver', { paths: [repoRoot] });
const chromePath = require.resolve('selenium-webdriver/chrome', { paths: [repoRoot] });

function createDriver(rowData) {
  return {
    async get() {},
    async wait() {},
    async executeScript() {},
    async sleep() {},
    async quit() {},
    async findElements(selector) {
      if (selector && selector.kind === 'rows') {
        return rowData.map((cols) => ({
          async findElements(tagSelector) {
            if (!tagSelector || tagSelector.kind !== 'tag' || tagSelector.value !== 'td') {
              return [];
            }
            return cols.map((value) => ({
              async getText() {
                return String(value);
              },
            }));
          },
        }));
      }
      return [];
    },
  };
}

async function withUniversalWebScrapeMocks({ driver, insertOrUpdateVehicle, markInactiveVehicles }, runTest) {
  const previousScrape = require.cache[scrapePath];
  const previousSeleniumScrape = require.cache[seleniumScrapePath];
  const previousManager = require.cache[managerPath];
  const previousSelenium = require.cache[seleniumPath];
  const previousChrome = require.cache[chromePath];
  const previousEngine = process.env.SCRAPER_ENGINE;

  class FakeBuilder {
    forBrowser() { return this; }
    setChromeOptions() { return this; }
    setChromeService() { return this; }
    async build() { return driver; }
  }

  require.cache[managerPath] = {
    id: managerPath,
    filename: managerPath,
    loaded: true,
    exports: { insertOrUpdateVehicle, markInactiveVehicles },
  };

  require.cache[seleniumPath] = {
    id: seleniumPath,
    filename: seleniumPath,
    loaded: true,
    exports: {
      Builder: FakeBuilder,
      By: {
        css: (value) => {
          if (value === '.table-responsive table tbody tr') {
            return { kind: 'rows', value };
          }
          return { kind: 'css', value };
        },
        tagName: (value) => ({ kind: 'tag', value }),
      },
      until: {
        elementLocated: () => ({}),
      },
    },
  };

  require.cache[chromePath] = {
    id: chromePath,
    filename: chromePath,
    loaded: true,
    exports: {
      Options: class {
        addArguments() {}
      },
      ServiceBuilder: class {},
    },
  };

  delete require.cache[scrapePath];
  delete require.cache[seleniumScrapePath];
  process.env.SCRAPER_ENGINE = 'selenium';

  try {
    const { universalWebScrape } = require(scrapePath);
    await runTest(universalWebScrape);
  } finally {
    if (previousScrape) require.cache[scrapePath] = previousScrape;
    else delete require.cache[scrapePath];

    if (previousSeleniumScrape) require.cache[seleniumScrapePath] = previousSeleniumScrape;
    else delete require.cache[seleniumScrapePath];

    if (previousManager) require.cache[managerPath] = previousManager;
    else delete require.cache[managerPath];

    if (previousSelenium) require.cache[seleniumPath] = previousSelenium;
    else delete require.cache[seleniumPath];

    if (previousChrome) require.cache[chromePath] = previousChrome;
    else delete require.cache[chromePath];

    if (typeof previousEngine === 'string') {
      process.env.SCRAPER_ENGINE = previousEngine;
    } else {
      delete process.env.SCRAPER_ENGINE;
    }
  }
}

test('universalWebScrape awaits all upserts before markInactiveVehicles', async () => {
  const eventLog = [];
  let insertCount = 0;

  await withUniversalWebScrapeMocks(
    {
      driver: createDriver([
        [2005, 'TOYOTA', 'CAMRY', 7],
        [2006, 'TOYOTA', 'COROLLA', 8],
      ]),
      insertOrUpdateVehicle: async () => {
        insertCount += 1;
        const index = insertCount;
        eventLog.push(`insert-start-${index}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        eventLog.push(`insert-end-${index}`);
      },
      markInactiveVehicles: async () => {
        eventLog.push('mark-inactive');
      },
    },
    async (universalWebScrape) => {
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: false,
        yardId: '1020',
        make: 'TOYOTA',
        model: 'ANY',
        sessionID: '20260101',
        shouldMarkInactive: true,
      });
    }
  );

  assert.equal(insertCount, 2);
  assert.deepEqual(eventLog, [
    'insert-start-1',
    'insert-end-1',
    'insert-start-2',
    'insert-end-2',
    'mark-inactive',
  ]);
});

test('universalWebScrape scopes inactive reconciliation and skips when disabled', async () => {
  const markCalls = [];

  await withUniversalWebScrapeMocks(
    {
      driver: createDriver([[2005, 'TOYOTA', 'CAMRY', 7]]),
      insertOrUpdateVehicle: async () => {},
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    },
    async (universalWebScrape) => {
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: false,
        yardId: '1021',
        make: 'ANY',
        model: 'ANY',
        sessionID: '20260101',
        shouldMarkInactive: false,
      });
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: false,
        yardId: '1021',
        make: 'ANY',
        model: 'ANY',
        sessionID: '20260101',
        shouldMarkInactive: true,
      });
    }
  );

  assert.equal(markCalls.length, 1);
  assert.equal(markCalls[0].sessionID, '20260101');
  assert.deepEqual(markCalls[0].options, { yardIds: [1021] });
});

test('universalWebScrape skips inactive reconciliation when scrape produced zero upserts', async () => {
  const markCalls = [];

  await withUniversalWebScrapeMocks(
    {
      driver: createDriver([]),
      insertOrUpdateVehicle: async () => {},
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    },
    async (universalWebScrape) => {
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: false,
        yardId: '1021',
        make: 'ANY',
        model: 'ANY',
        sessionID: '20260101',
        shouldMarkInactive: true,
      });
    }
  );

  assert.equal(markCalls.length, 0);
});

test('universalWebScrape skips inactive reconciliation when selenium scrape fails after partial upserts', async () => {
  const markCalls = [];
  let insertCount = 0;

  const successfulRow = {
    async findElements(tagSelector) {
      if (!tagSelector || tagSelector.kind !== 'tag' || tagSelector.value !== 'td') {
        return [];
      }
      return [2005, 'TOYOTA', 'CAMRY', 7].map((value) => ({
        async getText() {
          return String(value);
        },
      }));
    },
  };
  const failingRow = {
    async findElements() {
      throw new Error('simulated row parse failure');
    },
  };

  const driver = {
    async get() {},
    async wait() {},
    async executeScript() {},
    async sleep() {},
    async quit() {},
    async findElements(selector) {
      if (selector && selector.kind === 'rows') {
        return [successfulRow, failingRow];
      }
      return [];
    },
  };

  await withUniversalWebScrapeMocks(
    {
      driver,
      insertOrUpdateVehicle: async () => {
        insertCount += 1;
      },
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    },
    async (universalWebScrape) => {
      await assert.rejects(
        () => universalWebScrape({
          inventoryUrl: 'https://example.test',
          hasMultipleLocations: false,
          yardId: '1020',
          make: 'TOYOTA',
          model: 'CAMRY',
          sessionID: '20260101',
          shouldMarkInactive: true,
        }),
        /simulated row parse failure/
      );
    }
  );

  assert.equal(insertCount, 1);
  assert.equal(markCalls.length, 0);
});
