const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getUsageText,
  getYardNameById,
  normalizeSessionId,
  parseArgs,
  resolveScrapeTarget,
  resolveScrapeTargets,
  selectSentinelYard,
} = require('../src/testing/liveScrapeSmokeOptions');

test('smoke options expose stable defaults and help aliases', () => {
  assert.deepEqual(parseArgs([]), {
    location: 'boise',
    locations: null,
    make: 'TOYOTA',
    model: 'CAMRY',
    engine: null,
    dbPath: null,
    keepDb: false,
  });
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
  assert.match(getUsageText(), /--locations <a,b>/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument: --unknown/);
});

test('smoke options preserve current empty-value parsing behavior', () => {
  assert.equal(parseArgs(['--location']).location, '');
  assert.deepEqual(parseArgs(['--locations']).locations, []);
  assert.equal(parseArgs(['--engine']).engine, '');
  assert.equal(parseArgs(['--db-path']).dbPath, '');
});

test('smoke target resolution normalizes locations and maps multiple yards', () => {
  const seenLocations = [];
  const convertLocationToYardId = (location) => {
    seenLocations.push(location);
    return location === 'boise' ? '1020' : 1021;
  };

  assert.deepEqual(
    resolveScrapeTarget('  BOISE ', convertLocationToYardId),
    { junkyardKey: 'jalopyJungle', yardId: 1020 }
  );
  assert.deepEqual(
    resolveScrapeTargets(['boise', 'caldwell'], convertLocationToYardId),
    [
      { junkyardKey: 'jalopyJungle', yardId: 1020 },
      { junkyardKey: 'jalopyJungle', yardId: 1021 },
    ]
  );
  assert.deepEqual(seenLocations, ['boise', 'boise', 'caldwell']);
});

test('smoke option helpers preserve session and yard naming behavior', () => {
  assert.equal(normalizeSessionId('20260101'), '20260102');
  assert.equal(normalizeSessionId('session'), 'session1');
  assert.equal(getYardNameById(1020), 'BOISE');
  assert.equal(getYardNameById(123456), 'YARD_123456');
  assert.notEqual(selectSentinelYard(1020), 1020);
});
