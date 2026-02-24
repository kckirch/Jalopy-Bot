const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const universalPath = path.join(repoRoot, 'src/scraping/universalWebScrape.js');
const seleniumModulePath = path.join(repoRoot, 'src/scraping/seleniumInventoryScrape.js');
const httpModulePath = path.join(repoRoot, 'src/scraping/httpInventoryScrape.js');
const resolverPath = path.join(repoRoot, 'src/scraping/chromedriverResolver.js');

async function withEngineMocks({
  scraperEngineEnv,
  resolvedChromedriverPath = null,
  scrapeWithHttp = async () => {},
  scrapeWithSelenium = async () => {},
}, runTest) {
  const previousUniversal = require.cache[universalPath];
  const previousSelenium = require.cache[seleniumModulePath];
  const previousHttp = require.cache[httpModulePath];
  const previousResolver = require.cache[resolverPath];
  const previousEngine = process.env.SCRAPER_ENGINE;

  require.cache[seleniumModulePath] = {
    id: seleniumModulePath,
    filename: seleniumModulePath,
    loaded: true,
    exports: { scrapeWithSelenium },
  };

  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: { scrapeWithHttp },
  };

  require.cache[resolverPath] = {
    id: resolverPath,
    filename: resolverPath,
    loaded: true,
    exports: { resolveChromedriverPath: () => resolvedChromedriverPath },
  };

  if (typeof scraperEngineEnv === 'string') {
    process.env.SCRAPER_ENGINE = scraperEngineEnv;
  } else {
    delete process.env.SCRAPER_ENGINE;
  }

  delete require.cache[universalPath];

  try {
    const universalModule = require(universalPath);
    await runTest(universalModule);
  } finally {
    if (previousUniversal) require.cache[universalPath] = previousUniversal;
    else delete require.cache[universalPath];

    if (previousSelenium) require.cache[seleniumModulePath] = previousSelenium;
    else delete require.cache[seleniumModulePath];

    if (previousHttp) require.cache[httpModulePath] = previousHttp;
    else delete require.cache[httpModulePath];

    if (previousResolver) require.cache[resolverPath] = previousResolver;
    else delete require.cache[resolverPath];

    if (typeof previousEngine === 'string') {
      process.env.SCRAPER_ENGINE = previousEngine;
    } else {
      delete process.env.SCRAPER_ENGINE;
    }
  }
}

test('SCRAPER_ENGINE=http routes universalWebScrape to HTTP engine', async () => {
  const calls = [];

  await withEngineMocks({
    scraperEngineEnv: 'http',
    scrapeWithHttp: async (options, deps) => {
      calls.push({ type: 'http', options, deps });
    },
    scrapeWithSelenium: async () => {
      calls.push({ type: 'selenium' });
    },
  }, async ({ universalWebScrape }) => {
    await universalWebScrape({ inventoryUrl: 'https://example.test' }, { httpDeps: { token: 'x' } });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'http');
  assert.equal(calls[0].deps.token, 'x');
});

test('SCRAPER_ENGINE=selenium routes universalWebScrape to Selenium engine', async () => {
  const calls = [];

  await withEngineMocks({
    scraperEngineEnv: 'selenium',
    scrapeWithHttp: async () => {
      calls.push({ type: 'http' });
    },
    scrapeWithSelenium: async (options, deps) => {
      calls.push({ type: 'selenium', options, deps });
    },
  }, async ({ universalWebScrape }) => {
    await universalWebScrape({ inventoryUrl: 'https://example.test' }, { seleniumDeps: { token: 'y' } });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'selenium');
  assert.equal(calls[0].deps.token, 'y');
});

test('SCRAPER_ENGINE=auto selects Selenium when chromedriver path resolves', async () => {
  const calls = [];

  await withEngineMocks({
    scraperEngineEnv: 'auto',
    resolvedChromedriverPath: '/tmp/chromedriver',
    scrapeWithHttp: async () => {
      calls.push({ type: 'http' });
    },
    scrapeWithSelenium: async () => {
      calls.push({ type: 'selenium' });
    },
  }, async ({ universalWebScrape }) => {
    await universalWebScrape({ inventoryUrl: 'https://example.test' });
  });

  assert.deepEqual(calls, [{ type: 'selenium' }]);
});

test('SCRAPER_ENGINE=auto selects HTTP when chromedriver path does not resolve', async () => {
  const calls = [];

  await withEngineMocks({
    scraperEngineEnv: 'auto',
    resolvedChromedriverPath: null,
    scrapeWithHttp: async () => {
      calls.push({ type: 'http' });
    },
    scrapeWithSelenium: async () => {
      calls.push({ type: 'selenium' });
    },
  }, async ({ universalWebScrape }) => {
    await universalWebScrape({ inventoryUrl: 'https://example.test' });
  });

  assert.deepEqual(calls, [{ type: 'http' }]);
});

test('invalid SCRAPER_ENGINE falls back to auto selection', async () => {
  const calls = [];

  await withEngineMocks({
    scraperEngineEnv: 'invalid',
    resolvedChromedriverPath: null,
    scrapeWithHttp: async () => {
      calls.push({ type: 'http' });
    },
  }, async ({ universalWebScrape, __testables }) => {
    assert.equal(__testables.resolveConfiguredScraperEngine(process.env), 'auto');
    await universalWebScrape({ inventoryUrl: 'https://example.test' });
  });

  assert.deepEqual(calls, [{ type: 'http' }]);
});
