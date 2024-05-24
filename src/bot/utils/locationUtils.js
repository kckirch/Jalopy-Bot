const vehicleMakes = [
  'ACURA', 'ALFA ROMEO', 'AMC', 'AUDI', 'BMW', 'BUICK', 'CADILLAC',
  'CHEVROLET', 'CHRYSLER', 'DATSUN', 'DODGE', 'EAGLE', 'FIAT', 'FORD', 'GEO',
  'GMC', 'HONDA', 'HUMMER', 'HYUNDAI', 'INFINITI', 'ISUZU',
  'JAGUAR', 'JEEP', 'KIA', 'LAND ROVER', 'LEXUS',
  'LINCOLN', 'MAZDA', 'MERCEDES-BENZ', 'MERCURY', 'MG', 'MINI', 'MITSUBISHI', 'NASH',
  'NISSAN', 'OLDSMOBILE', 'PACKARD', 'PLYMOUTH', 'PONTIAC', 'PORSCHE', 'RAM',
  'SAAB', 'SATURN', 'SCION', 'SMART', 'SUBARU', 'SUZUKI',
  'TOYOTA', 'TRIUMPH', 'VOLKSWAGEN', 'VOLVO'
];

const makeAliases = {
  'Chevrolet': ['CHEVROLET', 'CHEVY', 'CHEV', 'chevy'],
  'Mercedes': ['MERCEDES', 'MERCEDES-BENZ', 'MERCEDES BENZ', 'BENZ', 'MERCEDESBENZ'],
  'Volkswagen': ['VW'],
  'Land Rover': ['LAND ROVER', 'LANDROVER'],
  'Mini': ['MINI COOPER'],
  'BMW': ['BIMMER'],
};

const reverseMakeAliases = Object.keys(makeAliases).reduce((acc, canonical) => {
  makeAliases[canonical].forEach(alias => {
    acc[alias.toUpperCase()] = canonical;
  });
  return acc;
}, {});

const yardIdMapping = {
  'BOISE': 1020,
  'CALDWELL': 1021,
  'GARDENCITY': 1119,
  'NAMPA': 1022,
  'TWINFALLS': 1099,
};

const treasureValleyYards = [1020, 1119, 1021, 1022];

function convertLocationToYardId(location) {
  if (location.toUpperCase() === 'ALL') {
    return 'ALL';
  } else if (location.toUpperCase() === 'TREASUREVALLEYYARDS') {
    return treasureValleyYards;
  }
  const normalizedLocation = location.toUpperCase().replace(/\s+/g, ''); // Remove all spaces
  return yardIdMapping[normalizedLocation] || 'ALL';
}

function convertYardIdToLocation(yardId) {
  console.log("Received yardId:", yardId);

  if (yardId === 'ALL') {
    return Object.keys(yardIdMapping).join(', ');
  } else if (Array.isArray(yardId)) {
    return yardId.map(id => findYardNameById(id)).join(', ');
  } else if (typeof yardId === 'string' && yardId.includes(',')) {
    const yardIds = yardId.split(',').map(id => id.trim());
    const yardNames = yardIds.map(id => findYardNameById(id));
    return yardNames.join(', ');
  } else if (typeof yardId === 'number' || (typeof yardId === 'string' && !isNaN(parseInt(yardId)))) {
    return findYardNameById(yardId);
  } else {
    console.error('Unexpected yardId input type:', typeof yardId);
    return 'Invalid Yard ID';
  }
}

function findYardNameById(id) {
  const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(id));
  return yardKey ? yardKey : 'Unknown Yard';
}

module.exports = {
  vehicleMakes,
  reverseMakeAliases,
  convertLocationToYardId,
  convertYardIdToLocation,
  yardIdMapping,
};
