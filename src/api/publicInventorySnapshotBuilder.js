const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sqlite3 = require('sqlite3').verbose();

function openDatabase(databasePath, mode) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, mode, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(database);
    });
  });
}

function closeDatabase(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function exec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function resolveSnapshotPaths(sourcePath, destinationPath) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const resolvedDestinationPath = path.resolve(destinationPath);
  if (resolvedSourcePath === resolvedDestinationPath) {
    throw new Error('Public inventory snapshot path must differ from the private runtime database path.');
  }
  return { resolvedSourcePath, resolvedDestinationPath };
}

function createReadOnlyDatabaseUri(databasePath) {
  const databaseUri = pathToFileURL(databasePath);
  databaseUri.searchParams.set('mode', 'ro');
  return databaseUri.href;
}

async function assertQuickCheck(database, sql, errorPrefix) {
  const row = await get(database, sql);
  const result = row && Object.values(row)[0];
  if (result !== 'ok') {
    throw new Error(`${errorPrefix}: ${result || 'unknown error'}`);
  }
}

async function readVehicleSchema(database) {
  const tableDefinition = await get(
    database,
    `SELECT sql
     FROM source.sqlite_master
     WHERE type = 'table' AND name = 'vehicles' AND sql IS NOT NULL;`
  );
  if (!tableDefinition?.sql) {
    throw new Error('Private runtime database does not contain a vehicles table.');
  }

  const indexDefinitions = await all(
    database,
    `SELECT sql
     FROM source.sqlite_master
     WHERE type = 'index' AND tbl_name = 'vehicles' AND sql IS NOT NULL
     ORDER BY name;`
  );
  return { tableDefinition, indexDefinitions };
}

async function copyVehicleData(database, schema) {
  await exec(database, schema.tableDefinition.sql);
  await run(database, 'INSERT INTO main.vehicles SELECT * FROM source.vehicles;');
  for (const indexDefinition of schema.indexDefinitions) {
    await exec(database, indexDefinition.sql);
  }
}

async function verifyVehicleCount(database) {
  const sourceCount = await get(
    database,
    'SELECT COUNT(*) AS count FROM source.vehicles;'
  );
  const snapshotCount = await get(
    database,
    'SELECT COUNT(*) AS count FROM main.vehicles;'
  );
  if (sourceCount.count !== snapshotCount.count) {
    throw new Error(
      `Public inventory snapshot row count mismatch: source=${sourceCount.count}, snapshot=${snapshotCount.count}`
    );
  }
  return snapshotCount.count;
}

async function verifyPublicSnapshot(database) {
  const publicTables = await all(
    database,
    `SELECT name
     FROM main.sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name;`
  );
  if (publicTables.length !== 1 || publicTables[0].name !== 'vehicles') {
    throw new Error('Public inventory snapshot contains an unexpected user table.');
  }
  await assertQuickCheck(
    database,
    'PRAGMA main.quick_check;',
    'Public inventory snapshot failed quick_check'
  );
}

async function cleanupFailedBuild({
  database,
  sourceAttached,
  transactionStarted,
  temporaryPath,
}) {
  if (database) {
    if (transactionStarted) {
      await exec(database, 'ROLLBACK;').catch(() => {});
    }
    if (sourceAttached) {
      await run(database, 'DETACH DATABASE source;').catch(() => {});
    }
    await closeDatabase(database).catch(() => {});
  }
  await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
}

async function publishSnapshot(temporaryPath, destinationPath) {
  await fs.promises.chmod(temporaryPath, 0o600);
  await fs.promises.rename(temporaryPath, destinationPath);
  return fs.promises.stat(destinationPath);
}

async function buildPublicInventorySnapshot(sourcePath, destinationPath) {
  const { resolvedSourcePath, resolvedDestinationPath } = resolveSnapshotPaths(
    sourcePath,
    destinationPath
  );
  await fs.promises.mkdir(path.dirname(resolvedDestinationPath), {
    recursive: true,
    mode: 0o700,
  });

  const temporaryPath = `${resolvedDestinationPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let database;
  let sourceAttached = false;
  let transactionStarted = false;

  try {
    database = await openDatabase(
      temporaryPath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_URI
    );
    await run(database, 'ATTACH DATABASE ? AS source;', [
      createReadOnlyDatabaseUri(resolvedSourcePath),
    ]);
    sourceAttached = true;

    await exec(database, 'BEGIN TRANSACTION;');
    transactionStarted = true;
    await assertQuickCheck(
      database,
      'PRAGMA source.quick_check;',
      'Private runtime database failed quick_check'
    );
    await copyVehicleData(database, await readVehicleSchema(database));
    const vehicleCount = await verifyVehicleCount(database);

    await exec(database, 'COMMIT;');
    transactionStarted = false;
    await verifyPublicSnapshot(database);

    await run(database, 'DETACH DATABASE source;');
    sourceAttached = false;
    await closeDatabase(database);
    database = null;

    const stat = await publishSnapshot(temporaryPath, resolvedDestinationPath);
    return { path: resolvedDestinationPath, stat, vehicleCount };
  } catch (error) {
    await cleanupFailedBuild({
      database,
      sourceAttached,
      transactionStarted,
      temporaryPath,
    });
    throw error;
  }
}

module.exports = { buildPublicInventorySnapshot };
