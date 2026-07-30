const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { LEGACY_VEHICLE_DB_PATH } = require('./dbPath');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');

function requireAbsolutePath(value, label) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    throw new Error(`${label} is required.`);
  }
  if (!path.isAbsolute(normalizedValue)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.normalize(normalizedValue);
}

function isPathWithin(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === ''
    || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

function resolveMigrationTarget(env = process.env) {
  return requireAbsolutePath(env.VEHICLE_DB_PATH, 'VEHICLE_DB_PATH');
}

function openReadOnlyDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (error) => {
      if (error) {
        reject(new Error(`Unable to open SQLite database at ${databasePath}: ${error.message}`, { cause: error }));
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

function getRow(database, sql) {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function getAllRows(database, sql) {
  return new Promise((resolve, reject) => {
    database.all(sql, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function validateSqliteDatabase(databasePath) {
  const databaseStat = fs.statSync(databasePath);
  if (!databaseStat.isFile() || databaseStat.size === 0) {
    throw new Error(`SQLite database is missing or empty at ${databasePath}.`);
  }

  const database = await openReadOnlyDatabase(databasePath);
  try {
    const row = await getRow(database, 'PRAGMA quick_check;');
    const result = row ? Object.values(row)[0] : '';
    if (result !== 'ok') {
      throw new Error(`SQLite quick_check failed for ${databasePath}: ${result || 'no result'}`);
    }

    const tables = await getAllRows(
      database,
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('vehicles', 'saved_searches');"
    );
    const tableNames = new Set(tables.map((table) => table.name));
    const missingTables = ['vehicles', 'saved_searches'].filter((table) => !tableNames.has(table));
    if (missingTables.length > 0) {
      throw new Error(
        `SQLite database at ${databasePath} is missing required table(s): ${missingTables.join(', ')}`
      );
    }
  } finally {
    await closeDatabase(database);
  }
}

async function backupSqliteDatabase(sourcePath, destinationPath) {
  const sourceDatabase = await openReadOnlyDatabase(sourcePath);

  try {
    await new Promise((resolve, reject) => {
      const backup = sourceDatabase.backup(destinationPath, (initializeError) => {
        if (initializeError) {
          reject(initializeError);
          return;
        }

        backup.step(-1, (stepError, completed) => {
          const completionError = stepError
            || (!completed ? new Error('SQLite backup did not complete in a full backup step.') : null);

          backup.finish(() => {
            if (completionError) {
              reject(completionError);
              return;
            }
            resolve();
          });
        });
      });

      backup.retryErrors = [];
    });
  } finally {
    await closeDatabase(sourceDatabase);
  }
}

async function migrateLegacyDatabase(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || REPOSITORY_ROOT);
  const sourcePath = requireAbsolutePath(
    options.sourcePath || LEGACY_VEHICLE_DB_PATH,
    'Legacy database path'
  );
  const targetPath = requireAbsolutePath(
    options.targetPath || resolveMigrationTarget(),
    'Runtime database path'
  );

  if (sourcePath === targetPath) {
    throw new Error('Runtime database path must differ from the legacy tracked database path.');
  }
  if (isPathWithin(repositoryRoot, targetPath)) {
    throw new Error('Runtime database path must be outside the Git checkout.');
  }

  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size === 0) {
    throw new Error(`Legacy database is missing or empty at ${sourcePath}.`);
  }

  await validateSqliteDatabase(sourcePath);

  if (fs.existsSync(targetPath)) {
    const targetStat = fs.statSync(targetPath);
    if (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) {
      throw new Error('Runtime database path resolves to the legacy database file.');
    }

    await validateSqliteDatabase(targetPath);
    return {
      sourcePath,
      status: 'already-exists',
      targetPath,
    };
  }

  const targetDirectory = path.dirname(targetPath);
  fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });

  const temporaryPath = path.join(
    targetDirectory,
    `.${path.basename(targetPath)}.migrating-${process.pid}-${crypto.randomUUID()}`
  );
  let targetCreated = false;

  try {
    await backupSqliteDatabase(sourcePath, temporaryPath);
    await validateSqliteDatabase(temporaryPath);
    fs.chmodSync(temporaryPath, 0o600);

    // A hard link publishes the completed backup atomically and fails if a
    // target appeared after the initial existence check.
    fs.linkSync(temporaryPath, targetPath);
    targetCreated = true;
    fs.unlinkSync(temporaryPath);

    await validateSqliteDatabase(targetPath);

    return {
      sourcePath,
      status: 'migrated',
      targetPath,
    };
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    if (targetCreated && fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    throw error;
  }
}

module.exports = {
  LEGACY_VEHICLE_DB_PATH,
  REPOSITORY_ROOT,
  backupSqliteDatabase,
  isPathWithin,
  migrateLegacyDatabase,
  resolveMigrationTarget,
  validateSqliteDatabase,
};
