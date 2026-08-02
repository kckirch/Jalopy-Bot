const test = require('node:test');
const assert = require('node:assert/strict');
const { captureConsole, joinedConsoleText } = require('../test-support/consoleCapture');
const {
  buildNormalizedSqlExpression,
  getMakeVariations,
  getModelVariations,
  normalizeModelForLooseComparison,
  parseYardIds,
  parseYearInput,
  scoreModelSuggestion,
} = require('../src/database/vehicleSearchNormalization');

test('model normalization removes punctuation consistently in JavaScript and SQL', () => {
  assert.equal(normalizeModelForLooseComparison(' RX-7 / sport '), 'RX7SPORT');

  const sqlExpression = buildNormalizedSqlExpression('vehicle_model');
  for (const character of [' ', '-', '/', '.', '_', '&']) {
    assert.equal(sqlExpression.includes(`'${character}'`), true, character);
  }
  assert.match(sqlExpression, /^REPLACE\(/);
});

test('year parsing preserves valid ranges and individual years', () => {
  assert.deepEqual(parseYearInput('2004-2005, 2010, invalid'), {
    conditions: 'vehicle_year BETWEEN ? AND ? OR vehicle_year = ?',
    params: [2004, 2005, 2010],
  });
  assert.deepEqual(parseYearInput(''), { conditions: '', params: [] });
  assert.deepEqual(parseYearInput('invalid'), { conditions: '', params: [] });
});

test('yard parsing handles scalar, list, and invalid input shapes', async () => {
  assert.deepEqual(parseYardIds(1020), [1020]);
  assert.deepEqual(parseYardIds('1020, 1021, invalid'), [1020, 1021]);
  assert.deepEqual(parseYardIds('ALL'), []);

  const privateValue = { path: '/home/kc/private-inventory.db' };
  const consoleCalls = await captureConsole(async () => {
    assert.deepEqual(parseYardIds(privateValue), []);
  });
  const logOutput = joinedConsoleText(consoleCalls);
  assert.match(logOutput, /Unexpected yardId input type: object/);
  assert.equal(logOutput.includes(privateValue.path), false);
});

test('make and model aliases produce wildcard query values', () => {
  assert.deepEqual(getMakeVariations('Chevrolet'), [
    '%chevrolet%',
    '%chevy%',
    '%chev%',
  ]);
  assert.deepEqual(getModelVariations('F150'), ['%f-150%', '%f%150%']);
  assert.deepEqual(getModelVariations('RX7'), ['%RX7%']);
});

test('model suggestion scoring prefers exact and normalized matches', () => {
  const exact = scoreModelSuggestion('RX-7', 'RX7', 'RX-7', 'RX7');
  const normalized = scoreModelSuggestion('RX 7', 'RX7', 'RX-7', 'RX7');
  const partial = scoreModelSuggestion('RX-7 SPORT', 'RX7SPORT', 'RX', 'RX');

  assert.ok(exact > normalized);
  assert.ok(normalized > partial);
  assert.equal(scoreModelSuggestion('CAMRY', 'CAMRY', 'RX7', 'RX7'), 0);
});
