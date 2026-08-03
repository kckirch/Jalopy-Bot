const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dispatchElementChange,
  forEachSelectOptionValue,
  processInventoryRows,
  selectValueAndSubmit,
} = require('../src/scraping/seleniumInventoryPage');

function option(value) {
  return {
    async getAttribute(name) {
      return name === 'value' ? value : null;
    },
  };
}

test('Selenium page helpers pass form values as script arguments', async () => {
  const calls = [];
  const driver = {
    async wait() {},
    async executeScript(...args) {
      calls.push(args);
    },
  };
  const untrustedValue = "CAMRY'; window.injected = true; //";

  await selectValueAndSubmit(driver, 'car-model', untrustedValue);
  await dispatchElementChange(driver, 'car-make');

  assert.equal(calls[0][1], 'car-model');
  assert.equal(calls[0][2], untrustedValue);
  assert.equal(calls[0][0].includes(untrustedValue), false);
  assert.match(calls[1][0], /searchinventory/);
  assert.equal(calls[2][1], 'car-make');
});

test('Selenium page helpers re-query select options and skip empty values', async () => {
  const visited = [];
  let queryCount = 0;
  const driver = {
    async wait() {},
    async findElements(selector) {
      assert.equal(selector.value, '#car-make option');
      queryCount += 1;
      return [option(''), option('TOYOTA'), option('HONDA')];
    },
  };

  await forEachSelectOptionValue(driver, 'car-make', async (value) => {
    visited.push(value);
  });

  assert.deepEqual(visited, ['TOYOTA', 'HONDA']);
  assert.equal(queryCount, 4);
});

test('Selenium page helpers process valid inventory rows sequentially', async () => {
  const processed = [];
  const values = [
    [],
    ['2005', 'TOYOTA', 'CAMRY', '7'],
    ['2006', 'HONDA', 'CIVIC', '8'],
  ];
  const driver = {
    async wait() {},
    async findElements(selector) {
      if (selector.value !== '.table-responsive table tbody tr') return [];
      return values.map((row) => ({
        async findElements() {
          return row.map((value) => ({
            async getText() {
              return value;
            },
          }));
        },
      }));
    },
  };

  const rowCount = await processInventoryRows(driver, async (vehicle) => {
    processed.push(vehicle);
  });

  assert.equal(rowCount, 2);
  assert.deepEqual(processed, [
    { year: 2005, make: 'TOYOTA', model: 'CAMRY', rowNumber: 7 },
    { year: 2006, make: 'HONDA', model: 'CIVIC', rowNumber: 8 },
  ]);
});
