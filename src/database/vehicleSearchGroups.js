const { reverseMakeAliases } = require('../config/vehicleMakes');
const { normalizeModelForLooseComparison: normalize } = require('./vehicleSearchNormalization');

// Mirrors the website's model-family rules. These are opt-in browsing groups,
// not spelling aliases or a claim that their parts interchange.
const FAMILY_RULES = {
  BMW: [
    ...Array.from({ length: 8 }, (_, index) => {
      const series = index + 1;
      return [`${series} SERIES`, new RegExp(`^(${series}SERIES|${series}\\d{2}[A-Z]*|M${series})$`)];
    }),
    ['X SERIES', /^(X[1-8][A-Z0-9]*|XM)$/],
    ['Z SERIES', /^Z[1-9][A-Z0-9]*$/],
    ['I SERIES', /^(I[3-9][A-Z0-9]*|IX)$/],
  ],
  'MERCEDES-BENZ': [
    ...['CLA', 'CLK', 'CLS', 'SLK', 'GLK', 'GL', 'ML', 'CL', 'SL', 'C', 'E', 'S', 'R']
      .map((prefix) => [`${prefix}-CLASS`, new RegExp(`^${prefix}(CLASS|\\d+[A-Z]*)$`)]),
    ['SPRINTER', /^SPRINTER\d+/],
  ],
  AUDI: [
    ...['RS', 'S', 'A', 'Q'].map((prefix) => [`${prefix} SERIES`, new RegExp(`^${prefix}\\d+[A-Z]*$`)]),
    ['TT SERIES', /^TT[A-Z0-9]*$/],
  ],
  LEXUS: ['ES', 'IS', 'RX', 'LS', 'GS', 'SC', 'LX', 'GX', 'UX', 'NX', 'RC', 'CT']
    .map((prefix) => [`${prefix} SERIES`, new RegExp(`^${prefix}\\d+[A-Z]*$`)]),
  INFINITI: ['QX', 'FX', 'EX', 'JX', 'G', 'M', 'I', 'Q']
    .map((prefix) => [`${prefix} SERIES`, new RegExp(`^${prefix}\\d+[A-Z]*$`)]),
  ACURA: [['TL FAMILY', /^(TL|TLX)$/]],
  MAZDA: [
    ['MAZDA 2 SERIES', /^MAZDA2$/],
    ...[3, 6].map((series) => [`MAZDA ${series} SERIES`, new RegExp(`^MAZDA(SPEED)?${series}$`)]),
    ['CX SERIES', /^CX\d+/], ['RX SERIES', /^RX\d+/],
    ['B-SERIES TRUCKS', /^(BSERIES|B\d{4})$/],
    ['MIATA / MX FAMILY', /^(MIATA$|MX\d+)/],
  ],
  FORD: [['F-SERIES TRUCKS', /^F\d{2,4}[A-Z]*$/]],
  CHEVROLET: [
    ['SILVERADO / C-K TRUCKS', /^(1500|2500|3500|C10|C20|C30|C1500|C2500|C3500|K10|K20|K1500|K2500|K3500|PU1500|SILVERADO|SILVERADO1500|SILVERADO2500|SILVERADOCLASSIC)$/],
    ['S10 FAMILY', /^(S10|BLAZERS10)/], ['TRAILBLAZER FAMILY', /^TRAILBLAZER/],
  ],
  GMC: [
    ['SIERRA / C-K TRUCKS', /^(1500|2500|3500|C1500|C2500|C3500|K2500|K3500|SIERRA|SIERRA3500)$/],
    ['ENVOY FAMILY', /^(ENVOY|JIMMYORENVOY)/],
  ],
  DODGE: [['RAM TRUCKS / VANS', /^(RAM\d+|RAMPICKUP|RAMVAN|RAMWAGON|RAMCHARGER|RAM50|1500PU|D\d{3}PICKUP|D\d{3}|W\d{3}PICKUP|W\d{3}|D\d{1,3})$/]],
  RAM: [
    ['PROMASTER FAMILY', /^PROMASTER/],
    ['RAM TRUCKS / VANS', /^(CV|1500|1500CLASSIC|2500|3500CHASSIS)$/],
  ],
  NISSAN: [
    ['Z SERIES', /^(280ZX|300ZX|350Z|370Z|400Z)$/],
    ['ROGUE FAMILY', /^ROGUE/], ['VERSA FAMILY', /^VERSA/],
  ],
  TOYOTA: [
    ['PRIUS FAMILY', /^PRIUS/], ['CAMRY FAMILY', /^CAMRY/],
    ['RAV4 FAMILY', /^RAV4/], ['4RUNNER FAMILY', /^4RUNNER$/],
  ],
  HONDA: [['CIVIC FAMILY', /^CIVIC/], ['ACCORD FAMILY', /^(ACCORD|CROSSTOUR)/]],
  JEEP: [['CHEROKEE FAMILY', /CHEROKEE/], ['WRANGLER FAMILY', /^WRANGLER/]],
  SUBARU: [['CROSSTREK FAMILY', /^(XVCROSSTREK|CROSSTREK)$/], ['TRIBECA FAMILY', /TRIBECA/]],
  VOLKSWAGEN: [
    ['BEETLE FAMILY', /^(BUG|BEETLE|NEWBEETLE)$/],
    ['GOLF / GTI FAMILY', /^(GTI$|GOLF)/], ['JETTA FAMILY', /^JETTA/],
  ],
  VOLVO: [
    ...['XC', 'S', 'V', 'C'].map((prefix) => [`${prefix} SERIES`, new RegExp(`^${prefix}\\d+`)]),
    ...[7, 8, 9].map((series) => [`${series}00 SERIES`, new RegExp(`^${series}\\d{2}(SERIES)?$`)]),
  ],
  HYUNDAI: [
    ['ELANTRA FAMILY', /^ELANTRA/], ['SONATA FAMILY', /^SONATA/],
    ['SANTA FE FAMILY', /^SANTAFE/], ['GENESIS FAMILY', /^GENESIS/],
  ],
  KIA: [['FORTE FAMILY', /^FORTE/], ['RIO FAMILY', /^RIO/], ['SPECTRA FAMILY', /^SPECTRA/]],
};

// US model-year shortcuts, not verified chassis identification. See README.
const BMW_GENERATIONS = [
  { code: 'E9X', aliases: ['E9X', 'E90', 'E91', 'E92', 'E93'], label: 'E9x 3 Series', years: [2006, 2013], pattern: /^(3SERIES|3\d{2}[A-Z]*|M3)$/ },
  { code: 'F3X', aliases: ['F3X', 'F30', 'F31', 'F34'], label: 'F3x 3 Series', years: [2012, 2019], pattern: /^(3SERIES|3\d{2}[A-Z]*)$/ },
];

function canonicalMake(make) {
  const value = String(make || '').trim().toUpperCase();
  return reverseMakeAliases[value] || value;
}

function getSearchGroups(make, model = '') {
  const rules = FAMILY_RULES[canonicalMake(make)] || [];
  const groups = rules.map(([label, pattern]) => ({
    value: `FAMILY: ${label}`, label, pattern,
    description: 'Related models; keeps your years, location and status.',
  }));
  if (canonicalMake(make) === 'BMW') {
    groups.push(...BMW_GENERATIONS.map(({ code, label, years, pattern, aliases }) => ({
      value: `GENERATION: ${code} (APPROX)`,
      label: `${label} · ${years.join('-')} (approx.)`,
      description: 'Sets model + years. Chassis unverified; transition years can overlap.',
      pattern, years, aliases,
    })));
  }
  const token = normalize(model);
  const relevance = (group) => group.aliases?.includes(token) ? 2 : Number(group.pattern.test(token));
  // Show relevant families first, but keep the other website families discoverable.
  return groups.sort((left, right) => relevance(right) - relevance(left));
}

function isSearchGroupFilter(model) {
  return /^(FAMILY|GENERATION):/i.test(String(model || '').trim());
}

function getSearchGroup(make, model) {
  const value = String(model || '').trim().toUpperCase();
  return getSearchGroups(make).find((group) => group.value === value);
}

function describeSearchGroup(make, model) {
  const group = getSearchGroup(make, model);
  if (!group) return '';
  return group.years
    ? `Approximate generation: ${group.label}. Model/year shortcut only; chassis is not verified and transition years can overlap.`
    : `Family: ${group.label}. Includes related models, not just spelling variants; parts compatibility is not implied.`;
}

module.exports = { getSearchGroups, getSearchGroup, isSearchGroupFilter, describeSearchGroup };
