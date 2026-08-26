const { YARDS } = require('../../config/yards');

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

  if (upperLocation === 'ALL') return 'ALL';
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
  if (yardId === 'ALL') return Object.keys(yardIdMapping).join(', ');
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

module.exports = { convertLocationToYardId, convertYardIdToLocation };
