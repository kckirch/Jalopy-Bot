const path = require('path');

const defaultDbPath = path.resolve(__dirname, '../bot/vehicleInventory.db');
const VEHICLE_DB_PATH = process.env.VEHICLE_DB_PATH
  ? path.resolve(process.env.VEHICLE_DB_PATH)
  : defaultDbPath;

module.exports = { VEHICLE_DB_PATH };
