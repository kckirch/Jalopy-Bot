const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'src/scraping/httpInventoryScrape.js');
const { __testables } = require(modulePath);

test('buildSubmissionPayload maps ANY make/model to empty values', () => {
  const payload = __testables.buildSubmissionPayload(
    {
      hiddenInputs: { __RequestVerificationToken: 'abc123' },
      fields: {
        yard: 'YardId',
        make: 'VehicleMake',
        model: 'VehicleModel',
      },
    },
    {
      yardId: 1020,
      make: 'ANY',
      model: 'ANY',
      hasMultipleLocations: true,
    }
  );

  assert.deepEqual(payload, {
    __RequestVerificationToken: 'abc123',
    YardId: '1020',
    VehicleMake: '',
    VehicleModel: '',
  });
});

test('buildSubmissionPayload omits yard field when location is not multi-select', () => {
  const payload = __testables.buildSubmissionPayload(
    {
      hiddenInputs: { __RequestVerificationToken: 'abc123' },
      fields: {
        yard: 'YardId',
        make: 'VehicleMake',
        model: 'VehicleModel',
      },
    },
    {
      yardId: 1020,
      make: 'TOYOTA',
      model: 'CAMRY',
      hasMultipleLocations: false,
    }
  );

  assert.deepEqual(payload, {
    __RequestVerificationToken: 'abc123',
    VehicleMake: 'TOYOTA',
    VehicleModel: 'CAMRY',
  });
});

test('normalizeSearchValue and uniqueNonEmptyStrings normalize values safely', () => {
  assert.equal(__testables.normalizeSearchValue('ANY'), '');
  assert.equal(__testables.normalizeSearchValue(' toyota '), 'toyota');

  const values = __testables.uniqueNonEmptyStrings(['TOYOTA', 'toyota', '  ', 'HONDA', 'Honda']);
  assert.deepEqual(values, ['TOYOTA', 'HONDA']);
});
