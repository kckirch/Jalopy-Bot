const test = require('node:test');
const assert = require('node:assert/strict');
const { getSearchGroups, getSearchGroup, describeSearchGroup } = require('../src/database/vehicleSearchGroups');
const { normalizeModelForLooseComparison: normalize, scoreModelSuggestion, getMakeSuggestions } = require('../src/database/vehicleSearchNormalization');
const { buildSearchViewPayload, buildSearchEditModal } = require('../src/bot/utils/searchInteractionView');
const { normalizeSearchCriteria, validateSearchCriteria } = require('../src/bot/utils/searchCriteria');

test('explicit family rules match the website families across all 21 supported makes', () => {
  const cases = [
    ['BMW', '3 Series', '3 SERIES'], ['BMW', 'M3', '3 SERIES'], ['BMW', '330CI', '3 SERIES'],
    ['BMW', 'X5 M', 'X SERIES'], ['BMW', 'XM', 'X SERIES'], ['BMW', 'Z4', 'Z SERIES'],
    ['BMW', 'i4', 'I SERIES'], ['BMW', 'iX', 'I SERIES'],
    ['Mercedes-Benz', 'C-Class', 'C-CLASS'], ['Mercedes-Benz', 'CLA 250', 'CLA-CLASS'],
    ['Mercedes-Benz', 'Sprinter 3500', 'SPRINTER'],
    ['Audi', 'A4', 'A SERIES'], ['Audi', 'S5', 'S SERIES'], ['Audi', 'RS7', 'RS SERIES'],
    ['Audi', 'Q5', 'Q SERIES'], ['Audi', 'TT RS', 'TT SERIES'],
    ['Lexus', 'RX 350', 'RX SERIES'], ['Infiniti', 'QX60', 'QX SERIES'], ['Infiniti', 'G35', 'G SERIES'],
    ['Acura', 'TL', 'TL FAMILY'], ['Acura', 'TLX', 'TL FAMILY'],
    ['Mazda', 'Mazda 2', 'MAZDA 2 SERIES'], ['Mazda', 'Mazdaspeed 3', 'MAZDA 3 SERIES'],
    ['Mazda', 'CX-5', 'CX SERIES'], ['Mazda', 'RX-7', 'RX SERIES'],
    ['Mazda', 'B-Series', 'B-SERIES TRUCKS'], ['Mazda', 'B2500', 'B-SERIES TRUCKS'],
    ['Mazda', 'Miata', 'MIATA / MX FAMILY'], ['Mazda', 'MX-5', 'MIATA / MX FAMILY'],
    ['Ford', 'F-150', 'F-SERIES TRUCKS'],
    ['Chevrolet', 'Silverado 1500', 'SILVERADO / C-K TRUCKS'],
    ['Chevrolet', 'S10 Blazer', 'S10 FAMILY'], ['Chevrolet', 'Trailblazer EXT', 'TRAILBLAZER FAMILY'],
    ['GMC', 'Sierra 3500', 'SIERRA / C-K TRUCKS'], ['GMC', 'Jimmy or Envoy', 'ENVOY FAMILY'],
    ['Dodge', 'Ram 1500', 'RAM TRUCKS / VANS'], ['Dodge', 'D150 Pickup', 'RAM TRUCKS / VANS'],
    ['Ram', 'ProMaster City', 'PROMASTER FAMILY'], ['Ram', 'ProMaster 1500', 'PROMASTER FAMILY'],
    ['Ram', '1500 Classic', 'RAM TRUCKS / VANS'],
    ['Nissan', '280ZX', 'Z SERIES'], ['Nissan', 'Rogue Sport', 'ROGUE FAMILY'], ['Nissan', 'Versa Note', 'VERSA FAMILY'],
    ['Toyota', 'Prius C', 'PRIUS FAMILY'], ['Toyota', 'Camry Solara', 'CAMRY FAMILY'],
    ['Toyota', 'RAV4', 'RAV4 FAMILY'], ['Toyota', '4 Runner', '4RUNNER FAMILY'],
    ['Honda', 'Civic Hybrid', 'CIVIC FAMILY'], ['Honda', 'Crosstour', 'ACCORD FAMILY'],
    ['Jeep', 'Grand Cherokee', 'CHEROKEE FAMILY'], ['Jeep', 'Wrangler Unlimited', 'WRANGLER FAMILY'],
    ['Subaru', 'XV Crosstrek', 'CROSSTREK FAMILY'], ['Subaru', 'B9 Tribeca', 'TRIBECA FAMILY'],
    ['Volkswagen', 'New Beetle', 'BEETLE FAMILY'], ['Volkswagen', 'GTI', 'GOLF / GTI FAMILY'],
    ['Volkswagen', 'Golf SportWagen', 'GOLF / GTI FAMILY'], ['Volkswagen', 'Jetta GLI', 'JETTA FAMILY'],
    ['Volvo', 'XC90', 'XC SERIES'], ['Volvo', 'S60', 'S SERIES'], ['Volvo', 'V70', 'V SERIES'],
    ['Volvo', 'C30', 'C SERIES'], ['Volvo', '740', '700 SERIES'], ['Volvo', '960 Series', '900 SERIES'],
    ['Hyundai', 'Elantra GT', 'ELANTRA FAMILY'], ['Hyundai', 'Sonata Hybrid', 'SONATA FAMILY'],
    ['Hyundai', 'Santa Fe', 'SANTA FE FAMILY'], ['Hyundai', 'Genesis Coupe', 'GENESIS FAMILY'],
    ['Kia', 'Forte Koup', 'FORTE FAMILY'], ['Kia', 'Rio5', 'RIO FAMILY'], ['Kia', 'Spectra5', 'SPECTRA FAMILY'],
  ];
  for (const [make, model, family] of cases) {
    const matches = getSearchGroups(make, model).filter((group) => !group.years && group.pattern.test(normalize(model)));
    assert.deepEqual(matches.map(({ label }) => label), [family], `${make} ${model}`);
    assert.equal(getSearchGroup(make, `FAMILY: ${family}`).label, family);
  }
});

test('families do not classify unrelated models or cross make boundaries', () => {
  for (const [make, model] of [
    ['BMW', 'RX330'], ['BMW', 'Isetta'], ['BMW', 'M35'], ['LEXUS', '330I'], ['FORD', 'Mustang'],
    ['TOYOTA', 'Corolla'], ['JEEP', 'Compass'], ['DODGE', 'Caravan'], ['GMC', 'Yukon'],
    ['CHEVROLET', 'Suburban'], ['VOLKSWAGEN', 'Passat'], ['MAZDA', '626'], ['HYUNDAI', 'Tucson'],
  ]) {
    assert(!getSearchGroups(make).some((group) => group.pattern.test(normalize(model))), `${make} ${model}`);
  }
  assert.deepEqual(getSearchGroups('ANY'), []);
  assert.deepEqual(getSearchGroups('unrecognized'), []);
  assert.equal(getSearchGroup('LEXUS', 'FAMILY: 3 SERIES'), undefined);
  assert.equal(getSearchGroup('ANY', 'GENERATION: E9X (APPROX)'), undefined);
  assert.equal(getSearchGroups('chevy', 'C1500')[0].label, 'SILVERADO / C-K TRUCKS');
  assert.equal(getSearchGroups('VW', 'GTI')[0].label, 'GOLF / GTI FAMILY');
  assert.equal(describeSearchGroup('BMW', '328I'), '');
});

test('generation codes are guided options, with bounded years and an explicit approximation', () => {
  for (const [input, code, years] of [
    ['E9x', 'E9X', [2006, 2013]], ['E90', 'E9X', [2006, 2013]], ['E93', 'E9X', [2006, 2013]],
    ['F3x', 'F3X', [2012, 2019]], ['F30', 'F3X', [2012, 2019]], ['F34', 'F3X', [2012, 2019]],
  ]) {
    const group = getSearchGroups('BMW', input)[0];
    assert.equal(group.value, `GENERATION: ${code} (APPROX)`);
    assert.deepEqual(group.years, years);
    assert.match(group.description, /Sets model \+ years.*unverified/);
    assert.match(describeSearchGroup('BMW', group.value), /chassis is not verified.*overlap/);
  }
  assert(getSearchGroup('BMW', 'GENERATION: E9X (APPROX)').pattern.test('M3'));
  const f3x = getSearchGroup('BMW', 'GENERATION: F3X (APPROX)');
  for (const model of ['M3', 'M4', '428I', 'X3']) assert(!f3x.pattern.test(model));
});

test('longer-name typo recovery does not fuzzy-correct valid model numbers', () => {
  const score = (input, model) => scoreModelSuggestion(model, normalize(model), input, normalize(input));
  for (const [input, model] of [['CORROLA', 'COROLLA'], ['4RUNER', '4RUNNER'], ['4RUNNRE', '4RUNNER']]) {
    assert(score(input, model) > 0, input);
    assert(score(model, model) > score(input, model));
  }
  for (const [input, model] of [['328I', '330I'], ['RX330', 'RX350'], ['F150', 'F250'], ['X3', 'X5'], ['CORROLA', 'CAMRY']]) {
    assert.equal(score(input, model), 0, `${input} => ${model}`);
  }
  assert.equal(score('LONGNAME'.repeat(30), 'LONGNAMD'.repeat(30)), 0);
  assert.equal(getMakeSuggestions('TOYTA')[0], 'TOYOTA');
  assert.equal(getMakeSuggestions('MERCEDS')[0], 'MERCEDES-BENZ');
  assert.equal(getMakeSuggestions('VW')[0], 'VOLKSWAGEN');
  assert.deepEqual(getMakeSuggestions('nonexistentmanufacturer'), []);
});

test('all guided responses and edit dialogs respect Discord component and text limits', () => {
  for (const make of ['BMW', 'MERCEDES-BENZ', 'LEXUS', 'TOYOTA', 'ANY']) {
    const criteria = normalizeSearchCriteria({ make, model: 'CORROLA', yearRange: '2008' });
    const state = { location: 'boise', yardId: 1020, vehicles: [], totalPages: 0, currentPage: 0,
      groups: getSearchGroups(make), suggestedModels: ['COROLLA'] };
    const payload = buildSearchViewPayload(state, criteria);
    assert(payload.components.length <= 5);
    for (const row of payload.components) {
      const json = row.toJSON();
      assert(json.components.length <= 5);
      for (const control of json.components) {
        assert(control.custom_id.length <= 100);
        if (control.options) assert(control.options.length <= 25);
      }
    }
    const modal = buildSearchEditModal(criteria, 'search:edit:fixture').toJSON();
    assert.equal(modal.components.length, 4);
    assert.equal(modal.components[0].components[0].value, make);
    assert(payload.embeds[0].toJSON().title.length <= 256);
  }
});

test('new input validation is shared by commands and modal submissions', () => {
  for (const [overrides, field] of [
    [{ make: 'X'.repeat(101) }, 'make'], [{ model: 'X'.repeat(101) }, 'model'],
    [{ yearRange: '2000,'.repeat(21) }, 'yearRange'], [{ status: 'whatever' }, 'status'],
    [{ model: 'FAMILY: UNKNOWN' }, 'model'], [{ model: '---' }, 'model'],
  ]) {
    assert.equal(validateSearchCriteria(normalizeSearchCriteria({ make: 'BMW', ...overrides })).field, field);
  }
  assert.equal(validateSearchCriteria(normalizeSearchCriteria({ make: 'BMW', model: 'FAMILY: 3 SERIES' })), null);
});
