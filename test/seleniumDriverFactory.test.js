const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CHROME_ARGUMENTS,
  createSeleniumDriver,
} = require('../src/scraping/seleniumDriverFactory');

function createFactoryFakes({ buildResult = {}, buildError = null } = {}) {
  const calls = [];

  class FakeBuilder {
    forBrowser(browser) {
      calls.push(['forBrowser', browser]);
      return this;
    }

    setChromeOptions(options) {
      calls.push(['setChromeOptions', options]);
      return this;
    }

    setChromeService(service) {
      calls.push(['setChromeService', service]);
      return this;
    }

    async build() {
      calls.push(['build']);
      if (buildError) throw buildError;
      return buildResult;
    }
  }

  class FakeOptions {
    addArguments(...args) {
      calls.push(['addArguments', ...args]);
    }
  }

  class FakeServiceBuilder {
    constructor(driverPath) {
      this.driverPath = driverPath;
    }
  }

  return {
    calls,
    dependencies: {
      Builder: FakeBuilder,
      chrome: {
        Options: FakeOptions,
        ServiceBuilder: FakeServiceBuilder,
      },
    },
  };
}

test('Selenium driver factory configures Chrome and a resolved driver path', async () => {
  const driver = {};
  const { calls, dependencies } = createFactoryFakes({ buildResult: driver });
  const logs = [];

  const result = await createSeleniumDriver({
    ...dependencies,
    resolveChromedriverPath: () => '/tmp/test-chromedriver',
    logger: {
      log: (message) => logs.push(['log', message]),
      warn: (message) => logs.push(['warn', message]),
    },
  });

  assert.equal(result, driver);
  assert.deepEqual(calls[0], ['addArguments', ...CHROME_ARGUMENTS]);
  assert.deepEqual(calls[1], ['forBrowser', 'chrome']);
  assert.equal(calls[2][0], 'setChromeOptions');
  assert.equal(calls[3][0], 'setChromeService');
  assert.equal(calls[3][1].driverPath, '/tmp/test-chromedriver');
  assert.deepEqual(calls[4], ['build']);
  assert.deepEqual(logs, [['log', 'Using configured Chromedriver.']]);
});

test('Selenium driver factory uses default resolution when no path is configured', async () => {
  const { calls, dependencies } = createFactoryFakes();
  const warnings = [];

  await createSeleniumDriver({
    ...dependencies,
    resolveChromedriverPath: () => null,
    logger: {
      log() {},
      warn: (message) => warnings.push(message),
    },
  });

  assert.equal(calls.some(([name]) => name === 'setChromeService'), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /default driver resolution/);
});

test('Selenium driver factory preserves browser startup failures', async () => {
  const startupError = new Error('simulated startup failure');
  const { dependencies } = createFactoryFakes({ buildError: startupError });

  await assert.rejects(
    createSeleniumDriver({
      ...dependencies,
      resolveChromedriverPath: () => null,
      logger: { log() {}, warn() {} },
    }),
    (error) => error === startupError
  );
});
