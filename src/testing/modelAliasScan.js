const { db } = require('../database/vehicleQueryManager');

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

function queryRows(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

function closeDb() {
  return new Promise((resolve, reject) => {
    db.close((error) => {
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

async function run() {
  const options = parseArgs(process.argv.slice(2));

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

  const rows = await queryRows(sql, params);
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

  console.log(`[alias-scan] analyzed models: ${rows.length}`);
  console.log(`[alias-scan] variant groups found: ${variantGroups.length}`);
  if (options.make) {
    console.log(`[alias-scan] make filter: ${options.make}`);
  }
  if (options.activeOnly) {
    console.log('[alias-scan] status filter: ACTIVE + NEW only');
  } else {
    console.log('[alias-scan] status filter: all historical rows');
  }
  console.log(`[alias-scan] showing top ${variantGroups.length} groups\n`);

  variantGroups.forEach((group, index) => {
    console.log(`${index + 1}. ${formatGroupLine(group)}`);
  });
}

run()
  .catch((error) => {
    console.error('[alias-scan] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDb();
    } catch (closeError) {
      console.error('[alias-scan] failed to close database:', closeError);
      process.exitCode = 1;
    }
  });
