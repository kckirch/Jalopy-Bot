const MAKE_ALIASES = {
  chevrolet: ['chevrolet', 'chevy', 'chev'],
  mercedes: [
    'mercedes',
    'mercedes-benz',
    'mercedes benz',
    'benz',
    'mercedesbenz',
  ],
  volkswagen: ['volkswagen', 'vw'],
  'land rover': ['land rover', 'landrover'],
  mini: ['mini', 'mini cooper'],
  bmw: ['bmw', 'bimmer'],
};

const MODEL_ALIASES = {
  1500: ['C1500', 'K1500', 'Silverado', 'Sierra'],
  2500: ['C2500', 'K2500', 'Silverado', 'Sierra'],
  3500: ['C3500', 'K3500', 'Silverado', 'Sierra'],
  '3 SERIES': [
    '3 series',
    '3-series',
    '3series',
    '318',
    '325',
    '328',
    '330',
    '330CI',
    '335',
    'M3',
    '340',
  ],
  '5 SERIES': [
    '5 series',
    '5-series',
    '5series',
    '528',
    '530I',
    '540',
    '545I',
    '550',
    'M5',
  ],
  '7 SERIES': ['7 series', '7-series', '7series', '750IL'],
  X: ['x3', 'X3', 'x5', 'X5', 'x6', 'X6'],
  'E CLASS': [
    'e class',
    'e-class',
    'eclass',
    'e320',
    'e350',
    'e500',
    'e550',
    'e63',
  ],
  'C CLASS': [
    'c class',
    'c-class',
    'cclass',
    'c230',
    'c240',
    'c250',
    'c280',
    'c300',
    'c320',
    'c350',
    'c63',
  ],
  'S CLASS': [
    's class',
    's-class',
    'sclass',
    's430',
    's500',
    's550',
    's600',
    's63',
  ],
  F150: ['f-150', 'f 150'],
  F250: ['f-250', 'f 250'],
  F350: ['f-350', 'f 350'],
  IS: ['IS250', 'IS300'],
  LS: ['LS400', 'LS430'],
  RX: ['RX300', 'RX350', 'RX400H'],
  SC: ['SC300', 'SC430'],
  'CR-V': ['CRV', 'CR V'],
  CHEROKEE: ['CHEROKEE'],
  'GRAND CHEROKEE': ['GRAND CHEROKEE'],
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

function parseYearInput(yearInput) {
  if (!yearInput || yearInput.trim() === '') {
    return { conditions: '', params: [] };
  }

  const conditions = [];
  const params = [];

  for (const rawSegment of yearInput.split(',')) {
    const segment = rawSegment.trim();
    if (segment.includes('-')) {
      const range = segment.split('-').map(Number);
      if (!Number.isNaN(range[0]) && !Number.isNaN(range[1])) {
        conditions.push('vehicle_year BETWEEN ? AND ?');
        params.push(range[0], range[1]);
      }
      continue;
    }

    const year = Number.parseInt(segment, 10);
    if (!Number.isNaN(year)) {
      conditions.push('vehicle_year = ?');
      params.push(year);
    }
  }

  if (conditions.length === 0) {
    return { conditions: '', params: [] };
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

  const aliases = MAKE_ALIASES[make.toLowerCase()] || [make];
  return aliases.map((alias) => `%${alias.replace(/\s+/g, '%')}%`);
}

function getModelVariations(model) {
  if (typeof model !== 'string') {
    console.error("Expected a string for 'model'.");
    return [];
  }

  const aliases = MODEL_ALIASES[model.toUpperCase()] || [model];
  return aliases.map((alias) => `%${alias.replace(/\s+/g, '%')}%`);
}

function scoreModelSuggestion(
  model,
  normalizedModel,
  inputModel,
  normalizedInput
) {
  const upperModel = String(model || '').toUpperCase();
  const upperInput = String(inputModel || '').toUpperCase();
  let score = 0;

  if (upperModel === upperInput) score += 200;
  if (normalizedModel !== '' && normalizedModel === normalizedInput) score += 180;
  if (upperInput !== '' && upperModel.startsWith(upperInput)) score += 90;
  if (normalizedInput !== '' && normalizedModel.startsWith(normalizedInput)) {
    score += 80;
  }
  if (upperInput !== '' && upperModel.includes(upperInput)) score += 50;
  if (normalizedInput !== '' && normalizedModel.includes(normalizedInput)) {
    score += 40;
  }

  return score;
}

module.exports = {
  buildNormalizedSqlExpression,
  getMakeVariations,
  getModelVariations,
  normalizeModelForLooseComparison,
  parseYardIds,
  parseYearInput,
  scoreModelSuggestion,
};
