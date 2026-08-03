const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const {
  extractOptionValues,
  extractResultRows,
  resolveFormMeta,
} = require('../src/scraping/httpInventoryParser');

test('HTTP parser resolves form metadata, hidden inputs, and field names', () => {
  const $ = cheerio.load(`
    <form id="searchinventory" method="post" action="/inventory/search">
      <input type="hidden" name="token" value="test-token">
      <input type="hidden" value="ignored">
      <select id="yard-id" name="YardId"></select>
      <select id="car-make" name="VehicleMake"></select>
    </form>
    <select id="car-model" name="VehicleModel"></select>
  `);

  assert.deepEqual(
    resolveFormMeta($, 'https://inventory.example/start'),
    {
      method: 'POST',
      actionUrl: 'https://inventory.example/inventory/search',
      hiddenInputs: { token: 'test-token' },
      fields: {
        yard: 'YardId',
        make: 'VehicleMake',
        model: 'VehicleModel',
      },
    }
  );
});

test('HTTP parser preserves prior metadata when a response omits the form', () => {
  const previousMeta = {
    method: 'POST',
    actionUrl: 'https://inventory.example/',
    hiddenInputs: {},
    fields: { yard: 'yard', make: 'make', model: 'model' },
  };

  assert.equal(
    resolveFormMeta(cheerio.load('<p>No form</p>'), 'https://inventory.example/', previousMeta),
    previousMeta
  );
  assert.throws(
    () => resolveFormMeta(cheerio.load('<p>No form</p>'), 'https://inventory.example/'),
    /Could not locate inventory search form/
  );
});

test('HTTP parser rejects non-HTTP inventory URLs and credentialed actions', () => {
  assert.throws(
    () => resolveFormMeta(
      cheerio.load('<form id="searchinventory"></form>'),
      'ftp://inventory.example/'
    ),
    /must use HTTP or HTTPS/
  );
  assert.throws(
    () => resolveFormMeta(
      cheerio.load('<form id="searchinventory" action="https://user:pass@inventory.example/"></form>'),
      'https://inventory.example/'
    ),
    /form action must stay on the configured origin/
  );
});

test('HTTP parser extracts non-empty options and valid inventory rows', () => {
  const $ = cheerio.load(`
    <select id="car-make">
      <option value="">Choose</option>
      <option value=" TOYOTA ">Toyota</option>
      <option>Missing value</option>
      <option value="HONDA">Honda</option>
    </select>
    <div class="table-responsive"><table><tbody>
      <tr><td>2005</td><td>TOYOTA</td><td>CAMRY</td><td>7</td></tr>
      <tr><td>bad year</td><td>HONDA</td><td>CIVIC</td><td>8</td></tr>
      <tr><td>2006</td><td></td><td>CIVIC</td><td>9</td></tr>
      <tr><td>2007</td><td>HONDA</td><td>ACCORD</td></tr>
    </tbody></table></div>
  `);

  assert.deepEqual(extractOptionValues($, '#car-make'), [
    'TOYOTA',
    'Missing value',
    'HONDA',
  ]);
  assert.deepEqual(extractResultRows($), [
    { year: 2005, make: 'TOYOTA', model: 'CAMRY', rowNumber: 7 },
  ]);
});
