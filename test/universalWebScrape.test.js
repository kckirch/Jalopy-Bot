const test = require('node:test');
const assert = require('node:assert/strict');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const { universalWebScrape } = require('../src/scraping/universalWebScrape');

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
      if (selector?.value === '.table-responsive table tbody tr') {
        return rowData.map((cols) => ({
          async findElements(tagSelector) {
            if (tagSelector?.value !== 'td') {
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
      if (selector?.value === '#car-make option') {
        return makeOptionValues.map(createSelectOption);
      }
      if (selector?.value === '#yard-id option') {
        return yardOptionValues.map(createSelectOption);
      }
      return [];
    },
  };
}

async function withSeleniumScrape(
  {
    driver,
    insertOrUpdateVehicle,
    markInactiveVehicles,
    driverBuildError = null,
  },
  runTest
) {
  const scrape = (options) =>
    universalWebScrape(options, {
      engine: 'selenium',
      seleniumDeps: {
        insertOrUpdateVehicle,
        markInactiveVehicles,
        async createDriver() {
          if (driverBuildError) throw driverBuildError;
          return driver;
        },
      },
    });

  await runTest(scrape);
}

test('universalWebScrape awaits all upserts before markInactiveVehicles', async () => {
  const eventLog = [];
  const upserts = [];
  let insertCount = 0;

  await withSeleniumScrape(
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

  await withSeleniumScrape(
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

test('universalWebScrape rejects inactive reconciliation when scrape produced zero upserts', async () => {
  const markCalls = [];

  await withSeleniumScrape(
    {
      driver: createDriver([]),
      insertOrUpdateVehicle: async () => {},
      markInactiveVehicles: async (sessionID, options) => {
        markCalls.push({ sessionID, options });
      },
    },
    async (universalWebScrape) => {
      await assert.rejects(
        universalWebScrape({
          inventoryUrl: 'https://example.test',
          hasMultipleLocations: false,
          yardId: '1021', make: 'ANY', model: 'ANY',
          sessionID: '20260101',
          shouldMarkInactive: true,
        }),
        /complete yard coverage/
      );
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
      if (tagSelector?.value !== 'td') {
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
      if (selector?.value === '.table-responsive table tbody tr') {
        return [successfulRow, failingRow];
      }
      return [];
    },
  };

  const consoleCalls = await captureConsole(async () => {
    await withSeleniumScrape(
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
            yardId: '1020', make: 'TOYOTA',
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

  const consoleCalls = await captureConsole(() =>
    withSeleniumScrape(
      {
        driver,
        insertOrUpdateVehicle: async (...args) => upserts.push(args),
        markInactiveVehicles: async (...args) => markCalls.push(args),
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
    )
  );

  assert.equal(upserts.length, 2);
  assert.ok(upserts.every((args) => args[0] === '1020'));
  assert.deepEqual(markCalls, [['20260101', { yardIds: [1020] }]]);

  const valueCalls = executionCalls.filter(([script]) =>
    script.includes('.value = arguments[1]')
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
  assert.equal(joinedConsoleText(consoleCalls).includes(model), false);
});

test('selenium scraper discovers multiple yards and scopes reconciliation to numeric IDs', async () => {
  const upserts = [];
  const markCalls = [];
  const driver = createDriver(
    [[2005, 'TOYOTA', 'CAMRY', 7]],
    {
      yardOptionValues: ['', '1020', '1020junk', 'invalid-yard', '1021'],
    }
  );

  await withSeleniumScrape(
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
    ['1020', '1020junk', 'invalid-yard', '1021']
  );
  assert.deepEqual(markCalls, [['20260101', { yardIds: [1020, 1021] }]]);
});

test('selenium scraper supports a selected yard on a multi-location page', async () => {
  const upserts = [];
  const markCalls = [];

  await withSeleniumScrape(
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
    await withSeleniumScrape(
      {
        driver: createDriver([[2005, 'TOYOTA', 'CAMRY', 7]]),
        insertOrUpdateVehicle: async () => {},
        markInactiveVehicles: async () => {
          throw new Error(privateErrorDetails);
        },
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
  assert.match(logOutput, /Error during inactive reconciliation: Error/);
  assert.equal(logOutput.includes(privateErrorDetails), false);
});

test('selenium scraper preserves the scrape error when browser cleanup also fails', async () => {
  const scrapeError = new Error('private scrape failure');
  const cleanupError = new Error('private cleanup failure');
  const driver = createDriver([]);
  driver.get = async () => {
    throw scrapeError;
  };
  driver.quit = async () => {
    throw cleanupError;
  };

  const consoleCalls = await captureConsole(async () => {
    await withSeleniumScrape(
      {
        driver,
        insertOrUpdateVehicle: async () => {},
        markInactiveVehicles: async () => {},
      },
      async (scrape) => {
        await assert.rejects(
          scrape({
            inventoryUrl: 'https://example.test',
            hasMultipleLocations: false,
            yardId: '1020',
            make: 'TOYOTA',
            model: 'CAMRY',
            sessionID: '20260101',
            shouldMarkInactive: true,
          }),
          (error) => error === scrapeError
        );
      }
    );
  });

  const logOutput = joinedConsoleText(consoleCalls);
  assert.match(logOutput, /Failed to close browser: Error/);
  assert.match(logOutput, /Scraping Duration:/);
  assert.equal(logOutput.includes(scrapeError.message), false);
  assert.equal(logOutput.includes(cleanupError.message), false);
});

test('selenium scraper reports browser cleanup failure after a successful scrape', async () => {
  const cleanupError = new Error('private cleanup failure');
  const driver = createDriver([[2005, 'TOYOTA', 'CAMRY', 7]]);
  driver.quit = async () => {
    throw cleanupError;
  };

  const consoleCalls = await captureConsole(async () => {
    await withSeleniumScrape(
      {
        driver,
        insertOrUpdateVehicle: async () => {},
        markInactiveVehicles: async () => {},
      },
      async (scrape) => {
        await assert.rejects(
          scrape({
            inventoryUrl: 'https://example.test',
            hasMultipleLocations: false,
            yardId: '1020',
            make: 'TOYOTA',
            model: 'CAMRY',
            sessionID: '20260101',
            shouldMarkInactive: false,
          }),
          (error) => error === cleanupError
        );
      }
    );
  });

  const logOutput = joinedConsoleText(consoleCalls);
  assert.match(logOutput, /Failed to close browser: Error/);
  assert.match(logOutput, /Scraping Duration:/);
  assert.equal(logOutput.includes(cleanupError.message), false);
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
    const consoleCalls = await captureConsole(async () => {
      await withSeleniumScrape(
        {
          driver: createDriver([]),
          driverBuildError: new Error(privateErrorDetails),
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
    assert.match(logOutput, /Scraping Duration:/);
    assert.doesNotMatch(logOutput, /Closing browser/);
    assert.equal(logOutput.includes(privateErrorDetails), false);
  }
});
