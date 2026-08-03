const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatScrapeLogValue,
  formatScrapeYardId,
  logScrapeRequest,
  logScrapeYardResult,
} = require('../src/scraping/scrapeLogging');
const {
  captureConsole,
  joinedConsoleText,
} = require('../test-support/consoleCapture');

test('scrape log values are single-line and bounded', () => {
  const value = `TOYOTA\nforged\u001b[31m${'x'.repeat(100)}`;
  const formatted = formatScrapeLogValue(value);

  assert.equal(formatted.includes('\n'), false);
  assert.equal(formatted.includes('\u001b'), false);
  assert.equal(Array.from(formatted).length, 80);
  assert.match(formatted, /…$/u);
});

test('scrape yard logging accepts only complete numeric yard IDs', () => {
  assert.equal(formatScrapeYardId(null), 'ALL');
  assert.equal(formatScrapeYardId('1020'), '1020');
  assert.equal(formatScrapeYardId('1020junk'), 'invalid');
  assert.equal(formatScrapeYardId('private-yard\nforged'), 'invalid');
});

test('scrape request logs scope without raw make, model, or invalid yard data', async () => {
  const privateMake = 'PRIVATE-MAKE\nforged-log-line';
  const privateModel = `PRIVATE-MODEL-${'x'.repeat(200)}`;
  const privateYard = 'PRIVATE-YARD\nforged-log-line';
  const privateSession = 'PRIVATE-SESSION-123';

  const consoleCalls = await captureConsole(() => {
    logScrapeRequest({
      yardId: privateYard,
      make: privateMake,
      model: privateModel,
      sessionID: privateSession,
    });
    logScrapeYardResult(privateYard, 12);
  });
  const output = joinedConsoleText(consoleCalls);

  assert.match(output, /Start yard=invalid scope=filtered/);
  assert.match(output, /Complete yard=invalid rows=12/);
  for (const privateValue of [
    privateMake,
    privateModel,
    privateYard,
    privateSession,
  ]) {
    assert.equal(output.includes(privateValue), false);
  }
  assert.equal(
    consoleCalls.filter((call) => call.method === 'log').length,
    2
  );
});

test('scrape result logs reject invalid row counts', async () => {
  const consoleCalls = await captureConsole(() =>
    logScrapeYardResult('1020', 'not-a-count')
  );

  assert.match(joinedConsoleText(consoleCalls), /yard=1020 rows=unknown/);
});
