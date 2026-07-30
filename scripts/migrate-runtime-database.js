const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../src/.env') });

const {
  LEGACY_VEHICLE_DB_PATH,
  migrateLegacyDatabase,
  resolveMigrationTarget,
} = require('../src/database/runtimeDatabaseMigration');

async function main() {
  const targetPath = resolveMigrationTarget();
  const result = await migrateLegacyDatabase({
    sourcePath: LEGACY_VEHICLE_DB_PATH,
    targetPath,
  });

  if (result.status === 'already-exists') {
    console.log(`Runtime database already exists and passed SQLite quick_check: ${result.targetPath}`);
    console.log('No files were changed.');
    return result;
  }

  console.log(`Migrated legacy database from ${result.sourcePath}`);
  console.log(`Runtime database created at ${result.targetPath}`);
  console.log('The legacy database was retained for rollback. Do not delete it until the deployed bot and API are verified.');
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Database migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
