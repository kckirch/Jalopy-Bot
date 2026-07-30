const path = require('path');

const LEGACY_VEHICLE_DB_PATH = path.resolve(__dirname, '../bot/vehicleInventory.db');

function resolveVehicleDbPath(env = process.env) {
  const configuredPath = String(env.VEHICLE_DB_PATH || '').trim();
  return configuredPath ? path.resolve(configuredPath) : LEGACY_VEHICLE_DB_PATH;
}

const VEHICLE_DB_PATH = resolveVehicleDbPath();
const USING_LEGACY_VEHICLE_DB_PATH = VEHICLE_DB_PATH === LEGACY_VEHICLE_DB_PATH;

if (USING_LEGACY_VEHICLE_DB_PATH && process.env.NODE_ENV !== 'test') {
  console.warn(
    `[database] VEHICLE_DB_PATH is not configured; using temporary legacy path ${LEGACY_VEHICLE_DB_PATH}`
  );
}

module.exports = {
  LEGACY_VEHICLE_DB_PATH,
  USING_LEGACY_VEHICLE_DB_PATH,
  VEHICLE_DB_PATH,
  resolveVehicleDbPath,
};
