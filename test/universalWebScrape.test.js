const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');

const repoRoot = path.resolve(__dirname, '..');
const scrapePath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const seleniumScrapePath = path.join(repoRoot, 'src/scraping/seleniumInventoryScrape.js');
const managerPath = path.join(repoRoot, 'src/database/vehicleDbInventoryManager.js');
const resolverPath = path.join(repoRoot, 'src/scraping/chromedriverResolver.js');
const seleniumPath = require.resolve('selenium-webdriver', { paths: [repoRoot] });
const chromePath = require.resolve('selenium-webdriver/chrome', { paths: [repoRoot] });

function createSelectOption(value) {
  return {
    async getAttribute(attribute) {
      return attribute === 'value' ? value : null;
    },
  };
}

function createDriver(
  rowData,
  {
    makeOptionValues = [],
    yardOptionValues = [],
    onExecuteScript = () => {},
  } = {}
) {
  return {
    async get() {},
    async wait() {},
    async executeScript(...args) {
      onExecuteScript(args);
    },
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
      if (selector?.kind === 'css' && selector.value === '#car-make option') {
        return makeOptionValues.map(createSelectOption);
      }
      if (selector?.kind === 'css' && selector.value === '#yard-id option') {
        return yardOptionValues.map(createSelectOption);
      }
      return [];
    },
  };
}

async function withUniversalWebScrapeMocks(
  {
    driver,
    insertOrUpdateVehicle,
    markInactiveVehicles,
    resolvedChromedriverPath = null,
    onSetChromeService = () => {},
  },
  runTest
) {
  const previousScrape = require.cache[scrapePath];
  const previousSeleniumScrape = require.cache[seleniumScrapePath];
  const previousManager = require.cache[managerPath];
  const previousResolver = require.cache[resolverPath];
  const previousSelenium = require.cache[seleniumPath];
  const previousChrome = require.cache[chromePath];
  const previousEngine = process.env.SCRAPER_ENGINE;

  class FakeBuilder {
    forBrowser() { return this; }
    setChromeOptions() { return this; }
    setChromeService(service) {
      onSetChromeService(service);
      return this;
    }
    async build() { return driver; }
  }

  require.cache[managerPath] = {
    id: managerPath,
    filename: managerPath,
    loaded: true,
    exports: { insertOrUpdateVehicle, markInactiveVehicles },
  };

  require.cache[resolverPath] = {
    id: resolverPath,
    filename: resolverPath,
    loaded: true,
    exports: {
      resolveChromedriverPath: () => resolvedChromedriverPath,
    },
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
      ServiceBuilder: class {
        constructor(driverPath) {
          this.driverPath = driverPath;
        }
      },
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

    if (previousResolver) require.cache[resolverPath] = previousResolver;
    else delete require.cache[resolverPath];

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
  const upserts = [];
  let insertCount = 0;

  await withUniversalWebScrapeMocks(
    {
      driver: createDriver([
        [2005, 'TOYOTA', 'CAMRY', 7],
        [2006, 'TOYOTA', 'COROLLA', 8],
      ]),
      insertOrUpdateVehicle: async (...args) => {
        upserts.push(args);
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
  assert.ok(upserts.every((args) => args.length === 7 && args[5] === '' && args[6] === '20260101'));
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
  const privateErrorDetails = 'private-user /home/kc/private-file';

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
      throw new Error(privateErrorDetails);
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

  const consoleCalls = await captureConsole(async () => {
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
          (error) => error.message === privateErrorDetails
        );
      }
    );
  });

  assert.equal(insertCount, 1);
  assert.equal(markCalls.length, 0);
  assert.match(joinedConsoleText(consoleCalls), /Scraping failed: Error/);
  assert.equal(joinedConsoleText(consoleCalls).includes(privateErrorDetails), false);
});

test('selenium scraper passes form values as script arguments and iterates make options', async () => {
  const executionCalls = [];
  const servicePaths = [];
  const upserts = [];
  const markCalls = [];
  const model = "CAMRY'; window.untrustedValue = true; //";
  const driver = createDriver(
    [[2005, 'TOYOTA', 'CAMRY', 7]],
    {
      makeOptionValues: ['', 'TOYOTA', '', 'HONDA'],
      onExecuteScript: (args) => executionCalls.push(args),
    }
  );

  await withUniversalWebScrapeMocks(
    {
      driver,
      insertOrUpdateVehicle: async (...args) => upserts.push(args),
      markInactiveVehicles: async (...args) => markCalls.push(args),
      resolvedChromedriverPath: '/tmp/test-chromedriver',
      onSetChromeService: (service) => servicePaths.push(service.driverPath),
    },
    async (universalWebScrape) => {
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: false,
        yardId: '1020',
        make: 'ANY',
        model,
        sessionID: '20260101',
        shouldMarkInactive: true,
      });
    }
  );

  assert.deepEqual(servicePaths, ['/tmp/test-chromedriver']);
  assert.equal(upserts.length, 2);
  assert.ok(upserts.every((args) => args[0] === '1020'));
  assert.deepEqual(markCalls, [['20260101', { yardIds: [1020] }]]);

  const valueCalls = executionCalls.filter(([script]) =>
    script.includes('arguments[0]')
  );
  assert.ok(
    valueCalls.some(
      ([, elementId, value]) => elementId === 'car-model' && value === model
    )
  );
  assert.deepEqual(
    valueCalls
      .filter(([, elementId]) => elementId === 'car-make')
      .map(([, , value]) => value),
    ['ANY', 'TOYOTA', 'HONDA']
  );
  assert.ok(executionCalls.every(([script]) => !script.includes(model)));
});

test('selenium scraper discovers multiple yards and scopes reconciliation to numeric IDs', async () => {
  const upserts = [];
  const markCalls = [];
  const driver = createDriver(
    [[2005, 'TOYOTA', 'CAMRY', 7]],
    {
      yardOptionValues: ['', '1020', '', 'invalid-yard', '1021'],
    }
  );

  await withUniversalWebScrapeMocks(
    {
      driver,
      insertOrUpdateVehicle: async (...args) => upserts.push(args),
      markInactiveVehicles: async (...args) => markCalls.push(args),
    },
    async (universalWebScrape) => {
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: true,
        make: 'TOYOTA',
        model: 'CAMRY',
        sessionID: '20260101',
        shouldMarkInactive: true,
      });
    }
  );

  assert.deepEqual(
    upserts.map(([yardId]) => yardId),
    ['1020', 'invalid-yard', '1021']
  );
  assert.deepEqual(markCalls, [['20260101', { yardIds: [1020, 1021] }]]);
});

test('selenium scraper supports a selected yard on a multi-location page', async () => {
  const upserts = [];
  const markCalls = [];

  await withUniversalWebScrapeMocks(
    {
      driver: createDriver([[2005, 'TOYOTA', 'CAMRY', 7]]),
      insertOrUpdateVehicle: async (...args) => upserts.push(args),
      markInactiveVehicles: async (...args) => markCalls.push(args),
    },
    async (universalWebScrape) => {
      await universalWebScrape({
        inventoryUrl: 'https://example.test',
        hasMultipleLocations: true,
        yardId: '1020',
        make: 'TOYOTA',
        model: 'CAMRY',
        sessionID: '20260101',
        shouldMarkInactive: true,
      });
    }
  );

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][0], '1020');
  assert.deepEqual(markCalls, [['20260101', { yardIds: [1020] }]]);
});

test('selenium scraper redacts inactive reconciliation failures', async () => {
  const privateErrorDetails = 'private-user /home/kc/private-reconcile';
  const consoleCalls = await captureConsole(async () => {
    await withUniversalWebScrapeMocks(
      {
        driver: createDriver([[2005, 'TOYOTA', 'CAMRY', 7]]),
        insertOrUpdateVehicle: async () => {},
        markInactiveVehicles: async () => {
          throw new Error(privateErrorDetails);
        },
      },
      async (universalWebScrape) => {
        await universalWebScrape({
          inventoryUrl: 'https://example.test',
          hasMultipleLocations: false,
          yardId: '1020',
          make: 'TOYOTA',
          model: 'CAMRY',
          sessionID: '20260101',
          shouldMarkInactive: true,
        });
      }
    );
  });

  const logOutput = joinedConsoleText(consoleCalls);
  assert.match(logOutput, /Error during inactive reconciliation: Error/);
  assert.equal(logOutput.includes(privateErrorDetails), false);
});

test('selenium scraper classifies driver startup failures without leaking details', async () => {
  const scenarios = [
    {
      privateErrorDetails: 'spawn /home/kc/private-driver ENOENT',
      expectedLog: /Chromedriver not found/,
    },
    {
      privateErrorDetails: 'session not created: private browser details',
      expectedLog: /Chromedriver version mismatch/,
    },
  ];

  for (const { privateErrorDetails, expectedLog } of scenarios) {
    const driver = createDriver([]);
    driver.get = async () => {
      throw new Error(privateErrorDetails);
    };

    const consoleCalls = await captureConsole(async () => {
      await withUniversalWebScrapeMocks(
        {
          driver,
          insertOrUpdateVehicle: async () => {},
          markInactiveVehicles: async () => {},
        },
        async (universalWebScrape) => {
          await assert.rejects(
            universalWebScrape({
              inventoryUrl: 'https://example.test',
              hasMultipleLocations: false,
              yardId: '1020',
              make: 'TOYOTA',
              model: 'CAMRY',
              sessionID: '20260101',
              shouldMarkInactive: true,
            }),
            (error) => error.message === privateErrorDetails
          );
        }
      );
    });

    const logOutput = joinedConsoleText(consoleCalls);
    assert.match(logOutput, expectedLog);
    assert.equal(logOutput.includes(privateErrorDetails), false);
  }
});
