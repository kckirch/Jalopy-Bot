const { resolveChromedriverPath } = require('./chromedriverResolver');
const { formatScrapeLogValue } = require('./scrapeLogging');

const VALID_SCRAPER_ENGINES = new Set(['auto', 'selenium', 'http']);

function resolveConfiguredScraperEngine(env = process.env) {
  const configured = String(env.SCRAPER_ENGINE || '').trim().toLowerCase();
  if (!configured) return 'auto';
  if (!VALID_SCRAPER_ENGINES.has(configured)) {
    console.warn('Invalid SCRAPER_ENGINE value. Falling back to auto.');
    return 'auto';
  }
  return configured;
}

function selectScraperEngine(env = process.env) {
  const configured = resolveConfiguredScraperEngine(env);
  if (configured !== 'auto') {
    return configured;
  }

  return resolveChromedriverPath() ? 'selenium' : 'http';
}

async function universalWebScrape(options, deps = {}) {
  const engine = deps.engine || selectScraperEngine(process.env);
  console.log(`Using scraper engine: ${formatScrapeLogValue(engine)}`);

  if (engine === 'http') {
    const { scrapeWithHttp } = require('./httpInventoryScrape');
    return scrapeWithHttp(options, deps.httpDeps || {});
  }

  if (engine === 'selenium') {
    const { scrapeWithSelenium } = require('./seleniumInventoryScrape');
    return scrapeWithSelenium(options, deps.seleniumDeps || {});
  }

  throw new Error(`Unsupported scraper engine: ${engine}`);
}

module.exports = {
  universalWebScrape,
  __testables: {
    resolveConfiguredScraperEngine,
    selectScraperEngine,
  },
};
