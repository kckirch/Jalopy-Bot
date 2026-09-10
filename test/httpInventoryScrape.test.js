const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSubmissionPayload,
  normalizeSearchValue,
  uniqueNonEmptyStrings,
} = require('../src/scraping/httpInventoryParser');

test('buildSubmissionPayload maps ANY make/model to empty values', () => {
  const payload = buildSubmissionPayload(
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
  const payload = buildSubmissionPayload(
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
  assert.equal(normalizeSearchValue('ANY'), '');
  assert.equal(normalizeSearchValue(' toyota '), 'toyota');

  const values = uniqueNonEmptyStrings(['TOYOTA', 'toyota', '  ', 'HONDA', 'Honda']);
  assert.deepEqual(values, ['TOYOTA', 'HONDA']);
});
