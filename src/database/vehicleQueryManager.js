const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');
const {
  buildNormalizedSqlExpression,
  getMakeVariations,
  getModelVariations,
  normalizeModelForLooseComparison,
  parseYardIds,
  parseYearInput,
  scoreModelSuggestion,
} = require('./vehicleSearchNormalization');

function queryAll(sql, params, failureMessage) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        console.error(failureMessage, summarizeError(error));
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

function queryVehicles(yardId, make, model, yearInput, status) {
  const yardIds = parseYardIds(yardId);
  const params = [];
  const conditions = [];
  let sql = 'SELECT * FROM vehicles';

  switch (status) {
    case 'NEW':
      conditions.push("vehicle_status = 'NEW'");
      break;
    case 'INACTIVE':
      conditions.push("vehicle_status = 'INACTIVE'");
      break;
    case 'ACTIVE':
    default:
      conditions.push("vehicle_status != 'INACTIVE'");
      break;
  }

  if (Array.isArray(yardIds) && yardIds.length > 0) {
    conditions.push(`yard_id IN (${yardIds.map(() => '?').join(', ')})`);
    params.push(...yardIds);
  }

  if (make !== 'ANY') {
    const makes = getMakeVariations(make);
    conditions.push(`(${makes.map(() => 'vehicle_make LIKE ?').join(' OR ')})`);
    params.push(...makes);
  }

  if (model !== 'ANY') {
    if (make.toUpperCase() === 'JEEP' && model.toUpperCase() === 'CHEROKEE') {
      conditions.push('vehicle_model LIKE ? AND vehicle_model NOT LIKE ?');
      params.push('%CHEROKEE%', '%GRAND CHEROKEE%');
    } else {
      const models = getModelVariations(model);
      const normalizedModel = normalizeModelForLooseComparison(model);
      const normalizedSql = buildNormalizedSqlExpression('vehicle_model');
      const modelPredicates = models.map(() => 'vehicle_model LIKE ?');
      const modelParams = [...models];

      if (normalizedModel !== '') {
        modelPredicates.push(`${normalizedSql} = ?`);
        modelParams.push(normalizedModel);
      }

      conditions.push(`(${modelPredicates.join(' OR ')})`);
      params.push(...modelParams);
    }
  }

  if (yearInput !== 'ANY') {
    const yearData = parseYearInput(yearInput);
    if (yearData.conditions) {
      conditions.push(`(${yearData.conditions})`);
      params.push(...yearData.params);
    }
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  return queryAll(sql, params, 'Failed to query vehicles:');
}

function getModelSuggestionsForNoResults(
  make = 'ANY',
  modelInput = '',
  yardId = 'ALL',
  limit = 8
) {
  const normalizedMake = String(make || 'ANY').trim().toUpperCase();
  const normalizedInput = normalizeModelForLooseComparison(modelInput);
  const upperInput = String(modelInput || '').trim().toUpperCase();
  const normalizedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 8;
  const yardIds = parseYardIds(yardId);

  let sql = `
    SELECT vehicle_model AS model, COUNT(*) AS count
    FROM vehicles
    WHERE 1 = 1
  `;
  const params = [];

  if (normalizedMake !== 'ANY' && normalizedMake !== '') {
    sql += ' AND UPPER(vehicle_make) = ?';
    params.push(normalizedMake);
  }

  if (yardId !== 'ALL' && Array.isArray(yardIds) && yardIds.length > 0) {
    sql += ` AND yard_id IN (${yardIds.map(() => '?').join(', ')})`;
    params.push(...yardIds);
  }

  sql += `
    GROUP BY vehicle_model
    ORDER BY count DESC, vehicle_model ASC
    LIMIT 250
  `;

  return queryAll(
    sql,
    params,
    'Failed to query no-result model suggestions:'
  ).then((rows) => {
    const rankedRows = (rows || [])
      .map((row) => {
        const normalizedModel = normalizeModelForLooseComparison(row.model);
        return {
          model: row.model,
          count: row.count,
          score: scoreModelSuggestion(
            row.model,
            normalizedModel,
            upperInput,
            normalizedInput
          ),
        };
      })
      .filter((row) => row.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.count - left.count ||
          String(left.model).localeCompare(String(right.model))
      );

    const uniqueModels = [];
    const seen = new Set();
    for (const row of rankedRows) {
      const key = String(row.model).toUpperCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      uniqueModels.push(row.model);
      if (uniqueModels.length >= normalizedLimit) {
        break;
      }
    }

    return uniqueModels;
  });
}

function getModelSuggestions(make = 'ANY', partialModel = '', limit = 25) {
  const normalizedMake = String(make || 'ANY').trim().toUpperCase();
  const normalizedPartialModel = String(partialModel || '')
    .trim()
    .toUpperCase();
  const normalizedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : 25;

  let sql = `
    SELECT vehicle_model AS model, COUNT(*) AS count
    FROM vehicles
    WHERE vehicle_status != 'INACTIVE'
  `;
  const params = [];

  if (normalizedMake !== 'ANY' && normalizedMake !== '') {
    sql += ' AND UPPER(vehicle_make) = ?';
    params.push(normalizedMake);
  }

  if (normalizedPartialModel !== '') {
    sql += ' AND UPPER(vehicle_model) LIKE ?';
    params.push(`%${normalizedPartialModel}%`);
  }

  sql += `
    GROUP BY vehicle_model
    ORDER BY count DESC, vehicle_model ASC
    LIMIT ?
  `;
  params.push(normalizedLimit);

  return queryAll(sql, params, 'Failed to query model suggestions:').then(
    (rows) => rows || []
  );
}

module.exports = {
  db,
  getModelSuggestions,
  getModelSuggestionsForNoResults,
  queryVehicles,
};
