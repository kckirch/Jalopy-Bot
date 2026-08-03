const { YARDS } = require('../config/yards');

const YARD_NAME_BY_ID = Object.freeze(
  Object.fromEntries(YARDS.map((yard) => [yard.id, yard.databaseName]))
);
const TRUSTY_YARD = YARDS.find(
  (yard) => yard.junkyardKey === 'trustyJunkyard'
);

const DEFAULT_SMOKE_OPTIONS = Object.freeze({
  location: 'boise',
  locations: null,
  make: 'TOYOTA',
  model: 'CAMRY',
  engine: null,
  dbPath: null,
  keepDb: false,
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLocations(value) {
  return normalizeText(value)
    .split(',')
    .map((location) => location.trim())
    .filter(Boolean);
}

function normalizeEngine(value) {
  return normalizeText(value).toLowerCase();
}

const VALUE_OPTIONS = new Map([
  ['--location', ['location', normalizeText]],
  ['--locations', ['locations', normalizeLocations]],
  ['--make', ['make', normalizeText]],
  ['--model', ['model', normalizeText]],
  ['--engine', ['engine', normalizeEngine]],
  ['--db-path', ['dbPath', normalizeText]],
]);

const FLAG_OPTIONS = new Map([
  ['--keep-db', 'keepDb'],
  ['--help', 'help'],
  ['-h', 'help'],
]);

function parseArgs(argv) {
  const args = { ...DEFAULT_SMOKE_OPTIONS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const flagName = FLAG_OPTIONS.get(arg);
    if (flagName) {
      args[flagName] = true;
      continue;
    }

    const option = VALUE_OPTIONS.get(arg);
    if (!option) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const [name, normalize] = option;
    args[name] = normalize(argv[i + 1]);
    i += 1;
  }

  return args;
}

function getUsageText() {
  return [
    'Usage: node src/testing/liveScrapeSmokeTest.js [options]',
    '',
    'Options:',
    '  --location <location>   Yard location (default: boise)',
    '  --locations <a,b>       Multi-yard smoke locations (e.g. boise,caldwell)',
    '  --make <make>           Partial scrape make (default: TOYOTA)',
    '  --model <model>         Partial scrape model (default: CAMRY)',
    '  --engine <mode>         Scraper engine: auto|selenium|http (default: env/auto)',
    '  --db-path <path>        Explicit isolated DB path (default: temp file)',
    '  --keep-db               Keep isolated DB after run',
    '  --help, -h              Show this help',
  ].join('\n');
}

function normalizeSessionId(sessionId) {
  const asNumber = Number(sessionId);
  if (Number.isNaN(asNumber)) return `${sessionId}1`;
  return String(asNumber + 1);
}

function resolveScrapeTarget(location, convertLocationToYardId) {
  const normalizedLocation = String(location || '').trim().toLowerCase();

  if (normalizedLocation === TRUSTY_YARD.slug) {
    return {
      junkyardKey: TRUSTY_YARD.junkyardKey,
      yardId: TRUSTY_YARD.id,
    };
  }

  const yardId = convertLocationToYardId(normalizedLocation);
  if (yardId === 'ALL' || Array.isArray(yardId)) {
    throw new Error(
      'Smoke test requires a single concrete location, not ALL or grouped locations.'
    );
  }

  return { junkyardKey: 'jalopyJungle', yardId: Number(yardId) };
}

function resolveScrapeTargets(locations, convertLocationToYardId) {
  return locations.map((location) =>
    resolveScrapeTarget(location, convertLocationToYardId)
  );
}

function getYardNameById(yardId) {
  return YARD_NAME_BY_ID[yardId] || `YARD_${yardId}`;
}

function selectSentinelYard(targetYardId) {
  const found = YARDS.map((yard) => yard.id).find(
    (yardId) => yardId !== Number(targetYardId)
  );
  if (!found) {
    throw new Error('Unable to find sentinel yard ID for smoke validation.');
  }
  return found;
}

module.exports = {
  getUsageText,
  getYardNameById,
  normalizeSessionId,
  parseArgs,
  resolveScrapeTarget,
  resolveScrapeTargets,
  selectSentinelYard,
};
