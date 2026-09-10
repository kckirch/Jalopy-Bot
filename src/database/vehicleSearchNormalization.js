const {
  makeAliases,
  reverseMakeAliases,
} = require('../config/vehicleMakes');

const MODEL_FAMILIES = {
  BMW: {
    '3 SERIES': ['318', '320', '323', '325', '328', '330', '335', 'M3', '340'],
    '5 SERIES': ['525', '528', '530', '535', '540', '545', '550', 'M5'],
    '7 SERIES': ['728', '730', '735', '740', '745', '750', '760'],
  },
  'MERCEDES-BENZ': {
    'E CLASS': ['E320', 'E350', 'E500', 'E550', 'E63'],
    'C CLASS': ['C230', 'C240', 'C250', 'C280', 'C300', 'C320', 'C350', 'C63'],
    'S CLASS': ['S430', 'S500', 'S550', 'S600', 'S63'],
  },
  // Preserve the existing truck-family shortcuts, scoped to their make.
  CHEVROLET: {
    1500: ['C1500', 'K1500', 'SILVERADO'],
    2500: ['C2500', 'K2500', 'SILVERADO'],
    3500: ['C3500', 'K3500', 'SILVERADO'],
  },
  GMC: {
    1500: ['C1500', 'K1500', 'SIERRA'],
    2500: ['C2500', 'K2500', 'SIERRA'],
    3500: ['C3500', 'K3500', 'SIERRA'],
  },
};

const MODEL_NORMALIZATION_PATTERN = /[^A-Z0-9]/g;

function normalizeModelForLooseComparison(value) {
  return String(value || '')
    .toUpperCase()
    .replace(MODEL_NORMALIZATION_PATTERN, '');
}

function buildNormalizedSqlExpression(columnName = 'vehicle_model') {
  let expression = `UPPER(${columnName})`;
  const removableCharacters = [' ', '-', '/', '.', '_', "'", '&'];

  for (const character of removableCharacters) {
    const sqlCharacter = character === "'" ? "''" : character;
    expression = `REPLACE(${expression}, '${sqlCharacter}', '')`;
  }

  return expression;
}

function parseYearInput(yearInput, { strict = false } = {}) {
  const input = String(yearInput || '').trim().toUpperCase();
  if (input === '' || input === 'ANY') {
    return { conditions: '', params: [] };
  }

  const conditions = [];
  const params = [];

  for (const rawSegment of input.split(',')) {
    const segment = rawSegment.trim();
    const match = segment.match(/^([1-9]\d{3})(?:\s*-\s*(\d{4}))?$/);
    if (strict && (!match || (match[2] && Number(match[2]) < Number(match[1])))) {
      throw new RangeError('Use a four-digit year, a range like 2006-2011, or comma-separated years. Ranges must go from oldest to newest.');
    }
    // Preserve legacy saved-filter parsing; new Discord input opts into strict validation.
    if (segment.includes('-')) {
      const [start, end] = segment.split('-').map(Number);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        conditions.push('vehicle_year BETWEEN ? AND ?');
        params.push(start, end);
      }
    } else {
      const year = Number.parseInt(segment, 10);
      if (!Number.isNaN(year)) {
        conditions.push('vehicle_year = ?');
        params.push(year);
      }
    }
  }

  return { conditions: conditions.join(' OR '), params };
}

function parseYardIds(input) {
  if (typeof input === 'string') {
    if (input.includes(',')) {
      return input
        .split(',')
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
    }

    const id = Number.parseInt(input.trim(), 10);
    return Number.isNaN(id) ? [] : [id];
  }

  if (Array.isArray(input)) {
    return input;
  }

  if (typeof input === 'number') {
    return [input];
  }

  console.error('Unexpected yardId input type:', typeof input);
  return [];
}

function getMakeVariations(make) {
  if (typeof make !== 'string') {
    console.error("Expected a string for 'make'.");
    return [];
  }

  const normalized = make.trim().toUpperCase();
  const canonical = reverseMakeAliases[normalized] || normalized;
  const aliases = makeAliases[canonical] || [canonical];
  return aliases.map((alias) =>
    `%${alias.toLowerCase().replace(/\s+/g, '%')}%`
  );
}

function getModelFamilyNames(make) {
  const normalizedMake = String(make || '').trim().toUpperCase();
  return Object.keys(MODEL_FAMILIES[reverseMakeAliases[normalizedMake] || normalizedMake] || {});
}

function getModelFamilyMakes(model) {
  const normalizedModel = normalizeModelForLooseComparison(model);
  return Object.keys(MODEL_FAMILIES).filter((make) =>
    getModelFamilyNames(make).some((name) => normalizeModelForLooseComparison(name) === normalizedModel));
}

function getModelVariations(model, make = 'ANY') {
  if (typeof model !== 'string') {
    console.error("Expected a string for 'model'.");
    return [];
  }

  const normalized = normalizeModelForLooseComparison(model);
  const normalizedMake = String(make || '').trim().toUpperCase();
  const families = MODEL_FAMILIES[reverseMakeAliases[normalizedMake] || normalizedMake] || {};
  const family = Object.keys(families).find((name) => normalizeModelForLooseComparison(name) === normalized);
  // Normalized substring matching already covers format variants and X/IS/RX etc.
  return [normalized, ...(families[family] || [])].map((alias) => `%${normalizeModelForLooseComparison(alias)}%`);
}

function isOneEditApart(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let index = 0;
  while (index < left.length && left[index] === right[index]) index += 1;
  if (left.length < right.length) return left.slice(index) === right.slice(index + 1);
  if (left.length > right.length) return left.slice(index + 1) === right.slice(index);
  return left.slice(index + 1) === right.slice(index + 1) ||
    (left[index] === right[index + 1] && left[index + 1] === right[index] &&
      left.slice(index + 2) === right.slice(index + 2));
}

function scoreModelSuggestion(
  model,
  normalizedModel,
  inputModel,
  normalizedInput
) {
  const upperModel = String(model || '').toUpperCase();
  const upperInput = String(inputModel || '').toUpperCase();
  if (normalizedInput === '') return 1;
  let score = 0;

  if (upperModel === upperInput) score += 200;
  if (normalizedModel === normalizedInput) score += 180;
  if (upperModel.startsWith(upperInput)) score += 90;
  if (normalizedModel.startsWith(normalizedInput)) {
    score += 80;
  }
  if (upperModel.includes(upperInput)) score += 50;
  if (normalizedModel.includes(normalizedInput)) {
    score += 40;
  }
  // ponytail: one edit only, suggestions never alter a saved filter automatically.
  if (score === 0 && Math.min(normalizedInput.length, normalizedModel.length) >= 4 &&
      isOneEditApart(normalizedInput, normalizedModel)) score = 20;

  return score;
}

module.exports = {
  buildNormalizedSqlExpression,
  getMakeVariations,
  getModelFamilyMakes,
  getModelFamilyNames,
  getModelVariations,
  normalizeModelForLooseComparison,
  parseYardIds,
  parseYearInput,
  scoreModelSuggestion,
};
