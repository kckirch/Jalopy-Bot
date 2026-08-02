const { summarizeError } = require('../utils/errorSummary');

const DEFAULT_LIMIT = 200;

function normalizeModel(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    make: null,
    activeOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--limit') {
      const parsed = Number.parseInt(argv[index + 1], 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        args.limit = parsed;
      }
      index += 1;
      continue;
    }

    if (token === '--make') {
      const make = String(argv[index + 1] || '').trim().toUpperCase();
      if (make) {
        args.make = make;
      }
      index += 1;
      continue;
    }

    if (token === '--active-only') {
      args.activeOnly = true;
      continue;
    }
  }

  return args;
}

function getDefaultDatabase() {
  return require('../database/vehicleQueryManager').db;
}

function queryRows(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
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

function formatGroupLine(group) {
  const variants = group.models
    .map((modelEntry) => `${modelEntry.model} (${modelEntry.count})`)
    .join(' | ');
  return `${group.make} :: ${group.key} => ${variants}`;
}

async function runModelAliasScan({
  argv = process.argv.slice(2),
  database = getDefaultDatabase(),
  logger = console,
} = {}) {
  const options = parseArgs(argv);

  const whereClauses = ['1 = 1'];
  const params = [];

  if (options.activeOnly) {
    whereClauses.push(`vehicle_status != 'INACTIVE'`);
  }

  if (options.make) {
    whereClauses.push(`UPPER(vehicle_make) = ?`);
    params.push(options.make);
  }

  const sql = `
    SELECT
      UPPER(vehicle_make) AS make,
      vehicle_model AS model,
      COUNT(*) AS count
    FROM vehicles
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY UPPER(vehicle_make), vehicle_model
  `;

  const rows = await queryRows(database, sql, params);
  const groupsMap = new Map();

  for (const row of rows) {
    const key = normalizeModel(row.model);
    if (!key) {
      continue;
    }
    const groupKey = `${row.make}::${key}`;
    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        make: row.make,
        key,
        totalCount: 0,
        models: [],
      });
    }
    const group = groupsMap.get(groupKey);
    group.totalCount += row.count;
    group.models.push({ model: row.model, count: row.count });
  }

  const variantGroups = [...groupsMap.values()]
    .map((group) => {
      const uniqueModels = [...new Set(group.models.map((entry) => entry.model.toUpperCase()))];
      return {
        ...group,
        uniqueModelCount: uniqueModels.length,
        models: group.models.sort((left, right) => right.count - left.count || left.model.localeCompare(right.model)),
      };
    })
    .filter((group) => group.uniqueModelCount > 1)
    .sort((left, right) =>
      right.uniqueModelCount - left.uniqueModelCount ||
      right.totalCount - left.totalCount ||
      left.make.localeCompare(right.make) ||
      left.key.localeCompare(right.key)
    )
    .slice(0, options.limit);

  logger.log(`[alias-scan] analyzed models: ${rows.length}`);
  logger.log(`[alias-scan] variant groups found: ${variantGroups.length}`);
  if (options.make) {
    logger.log(`[alias-scan] make filter: ${options.make}`);
  }
  if (options.activeOnly) {
    logger.log('[alias-scan] status filter: ACTIVE + NEW only');
  } else {
    logger.log('[alias-scan] status filter: all historical rows');
  }
  logger.log(`[alias-scan] showing top ${variantGroups.length} groups\n`);

  variantGroups.forEach((group, index) => {
    logger.log(`${index + 1}. ${formatGroupLine(group)}`);
  });

  return variantGroups;
}

async function runModelAliasScanCli({
  databaseFactory = getDefaultDatabase,
  runScan = runModelAliasScan,
  close = closeDatabase,
  logger = console,
} = {}) {
  let database;

  try {
    database = databaseFactory();
    await runScan({ database, logger });
  } catch (error) {
    logger.error('[alias-scan] failed:', summarizeError(error));
    process.exitCode = 1;
  } finally {
    if (database) {
      try {
        await close(database);
      } catch (closeError) {
        logger.error(
          '[alias-scan] failed to close database:',
          summarizeError(closeError)
        );
        process.exitCode = 1;
      }
    }
  }
}

if (require.main === module) {
  runModelAliasScanCli();
}

module.exports = {
  closeDatabase,
  formatGroupLine,
  normalizeModel,
  parseArgs,
  queryRows,
  runModelAliasScan,
  runModelAliasScanCli,
};
