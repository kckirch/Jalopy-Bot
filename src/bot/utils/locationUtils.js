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
    const normalizedLocation = location.toUpperCase().replace(/\s/g, '');
    return yardIdMapping[normalizedLocation] || 'ALL';
  }
  
  function convertYardIdToLocation(yardId) {
    console.log("Received yardId:", yardId);
  
    if (yardId === 'ALL') {
      const allYardNames = Object.keys(yardIdMapping).map(key => key.replace(/[A-Z]/g, ' $&').trim());
      return allYardNames.join(', ');
    } else if (Array.isArray(yardId)) {
      const yardNames = yardId.map(id => {
        const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(id));
        return yardKey || 'Unknown Yard';
      });
      return yardNames.join(', ');
    } else if (typeof yardId === 'string' && yardId.includes(',')) {
      return yardId.split(',').map(id => {
        const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(id.trim()));
        return yardKey || 'Unknown Yard';
      }).join(', ');
    } else if (typeof yardId === 'number' || (typeof yardId === 'string' && !isNaN(parseInt(yardId)))) {
      const yardKey = Object.keys(yardIdMapping).find(key => yardIdMapping[key] === parseInt(yardId));
      return yardKey || 'Unknown Yard';
    } else {
      console.error('Unexpected yardId input type:', typeof yardId);
      return 'Invalid Yard ID';
    }
  }
  
  module.exports = {
    vehicleMakes,
    reverseMakeAliases,
    convertLocationToYardId,
    convertYardIdToLocation,
  };
  