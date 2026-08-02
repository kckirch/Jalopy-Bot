const { YARDS } = require('../../config/yards');

const vehicleMakes = [
  'ACURA',
  'ALFA ROMEO',
  'AMC',
  'AUDI',
  'BMW',
  'BUICK',
  'CADILLAC',
  'CHEVROLET',
  'CHRYSLER',
  'DATSUN',
  'DODGE',
  'EAGLE',
  'FIAT',
  'FORD',
  'GEO',
  'GMC',
  'HONDA',
  'HUMMER',
  'HYUNDAI',
  'INFINITI',
  'ISUZU',
  'JAGUAR',
  'JEEP',
  'KIA',
  'LAND ROVER',
  'LEXUS',
  'LINCOLN',
  'MAZDA',
  'MERCEDES-BENZ',
  'MERCURY',
  'MG',
  'MINI',
  'MITSUBISHI',
  'NASH',
  'NISSAN',
  'OLDSMOBILE',
  'PACKARD',
  'PLYMOUTH',
  'PONTIAC',
  'PORSCHE',
  'RAM',
  'SAAB',
  'SATURN',
  'SCION',
  'SMART',
  'SUBARU',
  'SUZUKI',
  'TOYOTA',
  'TRIUMPH',
  'VOLKSWAGEN',
  'VOLVO',
];

const makeAliases = {
  Chevrolet: ['CHEVROLET', 'CHEVY', 'CHEV', 'chevy'],
  Mercedes: [
    'MERCEDES',
    'MERCEDES-BENZ',
    'MERCEDES BENZ',
    'BENZ',
    'MERCEDESBENZ',
  ],
  Volkswagen: ['VW'],
  'Land Rover': ['LAND ROVER', 'LANDROVER'],
  Mini: ['MINI COOPER'],
  BMW: ['BIMMER'],
};

const reverseMakeAliases = Object.keys(makeAliases).reduce(
  (aliases, canonical) => {
    makeAliases[canonical].forEach((alias) => {
      aliases[alias.toUpperCase()] = canonical;
    });
    return aliases;
  },
  {}
);

const yardIdMapping = Object.freeze(
  Object.fromEntries(YARDS.map((yard) => [yard.databaseName, yard.id]))
);
const yardNameById = Object.freeze(
  Object.fromEntries(YARDS.map((yard) => [yard.id, yard.databaseName]))
);
const treasureValleyYards = Object.freeze(
  YARDS.filter((yard) => yard.treasureValleyOrder !== null)
    .sort((left, right) => left.treasureValleyOrder - right.treasureValleyOrder)
    .map((yard) => yard.id)
);

function convertLocationToYardId(location) {
  const upperLocation = location.toUpperCase();

  if (upperLocation === 'ALL') {
    return 'ALL';
  }
  if (upperLocation === 'TREASUREVALLEYYARDS') {
    return [...treasureValleyYards];
  }

  const normalizedLocation = upperLocation.replace(/\s+/g, '');
  return yardIdMapping[normalizedLocation] || 'ALL';
}

function findYardNameById(id) {
  return yardNameById[Number.parseInt(id, 10)] || 'Unknown Yard';
}

function convertYardIdToLocation(yardId) {
  if (yardId === 'ALL') {
    return Object.keys(yardIdMapping).join(', ');
  }
  if (Array.isArray(yardId)) {
    return yardId.map((id) => findYardNameById(id)).join(', ');
  }
  if (typeof yardId === 'string' && yardId.includes(',')) {
    return yardId
      .split(',')
      .map((id) => findYardNameById(id.trim()))
      .join(', ');
  }
  if (
    typeof yardId === 'number' ||
    (typeof yardId === 'string' &&
      !Number.isNaN(Number.parseInt(yardId, 10)))
  ) {
    return findYardNameById(yardId);
  }

  console.error('Unexpected yardId input type:', typeof yardId);
  return 'Invalid Yard ID';
}

module.exports = {
  vehicleMakes,
  reverseMakeAliases,
  convertLocationToYardId,
  convertYardIdToLocation,
};
