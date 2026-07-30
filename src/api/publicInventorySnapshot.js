const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

async function buildPublicInventorySnapshot(sourcePath, destinationPath) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const resolvedDestinationPath = path.resolve(destinationPath);

  if (resolvedSourcePath === resolvedDestinationPath) {
    throw new Error('Public inventory snapshot path must differ from the private runtime database path.');
  }

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
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
    );
    await run(database, 'ATTACH DATABASE ? AS source;', [resolvedSourcePath]);
    sourceAttached = true;

    await exec(database, 'BEGIN TRANSACTION;');
    transactionStarted = true;

    const integrityRow = await get(database, 'PRAGMA source.quick_check;');
    const integrityResult = integrityRow && Object.values(integrityRow)[0];
    if (integrityResult !== 'ok') {
      throw new Error(`Private runtime database failed quick_check: ${integrityResult || 'unknown error'}`);
    }

    const tableDefinition = await get(
      database,
      `SELECT sql
       FROM source.sqlite_master
       WHERE type = 'table' AND name = 'vehicles' AND sql IS NOT NULL;`
    );
    if (!tableDefinition || !tableDefinition.sql) {
      throw new Error('Private runtime database does not contain a vehicles table.');
    }

    const indexDefinitions = await all(
      database,
      `SELECT sql
       FROM source.sqlite_master
       WHERE type = 'index' AND tbl_name = 'vehicles' AND sql IS NOT NULL
       ORDER BY name;`
    );

    await exec(database, tableDefinition.sql);
    await run(database, 'INSERT INTO main.vehicles SELECT * FROM source.vehicles;');

    for (const indexDefinition of indexDefinitions) {
      await exec(database, indexDefinition.sql);
    }

    const sourceCount = await get(database, 'SELECT COUNT(*) AS count FROM source.vehicles;');
    const snapshotCount = await get(database, 'SELECT COUNT(*) AS count FROM main.vehicles;');
    if (sourceCount.count !== snapshotCount.count) {
      throw new Error(
        `Public inventory snapshot row count mismatch: source=${sourceCount.count}, snapshot=${snapshotCount.count}`
      );
    }

    await exec(database, 'COMMIT;');
    transactionStarted = false;

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

    const snapshotIntegrityRow = await get(database, 'PRAGMA main.quick_check;');
    const snapshotIntegrityResult = snapshotIntegrityRow && Object.values(snapshotIntegrityRow)[0];
    if (snapshotIntegrityResult !== 'ok') {
      throw new Error(
        `Public inventory snapshot failed quick_check: ${snapshotIntegrityResult || 'unknown error'}`
      );
    }

    await run(database, 'DETACH DATABASE source;');
    sourceAttached = false;
    await closeDatabase(database);
    database = null;

    await fs.promises.chmod(temporaryPath, 0o600);
    await fs.promises.rename(temporaryPath, resolvedDestinationPath);
    const stat = await fs.promises.stat(resolvedDestinationPath);

    return {
      path: resolvedDestinationPath,
      stat,
      vehicleCount: snapshotCount.count,
    };
  } catch (error) {
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
    throw error;
  }
}

function createPublicInventorySnapshotProvider({
  sourceDatabase,
  sourcePath,
  snapshotPath,
}) {
  let currentSnapshot = null;
  let buildPromise = null;

  async function getDataVersion() {
    const row = await get(sourceDatabase, 'PRAGMA data_version;');
    const dataVersion = row && Number(row.data_version);
    if (!Number.isInteger(dataVersion)) {
      throw new Error('Unable to read SQLite data_version for the private runtime database.');
    }
    return dataVersion;
  }

  async function getSnapshot() {
    const dataVersion = await getDataVersion();

    if (
      currentSnapshot &&
      currentSnapshot.dataVersion === dataVersion &&
      fs.existsSync(currentSnapshot.path)
    ) {
      return currentSnapshot;
    }

    if (buildPromise) {
      await buildPromise;
      return getSnapshot();
    }

    const pendingBuild = buildPublicInventorySnapshot(sourcePath, snapshotPath).then((snapshot) => {
      currentSnapshot = {
        ...snapshot,
        dataVersion,
      };
      return currentSnapshot;
    });
    buildPromise = pendingBuild;

    try {
      return await pendingBuild;
    } finally {
      if (buildPromise === pendingBuild) {
        buildPromise = null;
      }
    }
  }

  return {
    getSnapshot,
  };
}

module.exports = {
  buildPublicInventorySnapshot,
  createPublicInventorySnapshotProvider,
};
