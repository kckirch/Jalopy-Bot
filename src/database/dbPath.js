const path = require('path');

function resolveVehicleDbPath(env = process.env) {
  const configuredPath = String(env.VEHICLE_DB_PATH || '').trim();
  if (!configuredPath) {
    throw new Error('VEHICLE_DB_PATH is required.');
  }
  if (!path.isAbsolute(configuredPath)) {
    throw new Error('VEHICLE_DB_PATH must be an absolute path outside the Git checkout.');
  }
  return path.normalize(configuredPath);
}

const VEHICLE_DB_PATH = resolveVehicleDbPath();

module.exports = {
  VEHICLE_DB_PATH,
  resolveVehicleDbPath,
};
