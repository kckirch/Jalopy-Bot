const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');
const { getSearchGroup, isSearchGroupFilter } = require('./vehicleSearchGroups');
const {
  buildNormalizedSqlExpression,
  getMakeVariations,
  getModelFamilyMakes,
  getModelFamilyNames,
  getModelVariations,
  normalizeModelForLooseComparison,
  parseYardIds,
  parseYearInput,
  scoreModelSuggestion,
} = require('./vehicleSearchNormalization');

const STATUS_CONDITIONS = new Map([
  ['NEW', "vehicle_status = 'NEW'"],
  ['INACTIVE', "vehicle_status = 'INACTIVE'"],
]);

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

function buildModelFilter(make, model) {
  if (make === 'JEEP' && model === 'CHEROKEE') {
    return { condition: 'vehicle_model LIKE ? AND vehicle_model NOT LIKE ?', params: ['%CHEROKEE%', '%GRAND CHEROKEE%'] };
  }
  const models = getModelVariations(model, make);
  const normalizedSql = buildNormalizedSqlExpression('vehicle_model');
  const modelConditions = models.map(() => `${normalizedSql} LIKE ?`);
  const params = [...models];
  // With no make selected, retain literal matches and expand each family only within its make.
  if (make === 'ANY') {
    for (const familyMake of getModelFamilyMakes(model)) {
      const familyMakes = getMakeVariations(familyMake);
      const familyModels = getModelVariations(model, familyMake);
      modelConditions.push(`((${familyMakes.map(() => 'vehicle_make LIKE ?').join(' OR ')}) AND (${familyModels.map(() => `${normalizedSql} LIKE ?`).join(' OR ')}))`);
      params.push(...familyMakes, ...familyModels);
    }
  }
  return { condition: `(${modelConditions.join(' OR ')})`, params };
}

async function queryVehicles(yardId, make, model, yearInput, status) {
  make = String(make || 'ANY').trim().toUpperCase();
  model = String(model || 'ANY').trim().toUpperCase();
  const group = getSearchGroup(make, model);
  // Unknown/cross-make group tokens must never fall back to an unrestricted query.
  if (isSearchGroupFilter(model) && !group) return [];
  const yardIds = parseYardIds(yardId);
  const params = [];
  const conditions = [STATUS_CONDITIONS.get(status) || "vehicle_status != 'INACTIVE'"];

  if (Array.isArray(yardIds) && yardIds.length > 0) {
    conditions.push(`yard_id IN (${yardIds.map(() => '?').join(', ')})`);
    params.push(...yardIds);
  }

  if (make !== 'ANY') {
    const makes = getMakeVariations(make);
    conditions.push(`(${makes.map(() => 'vehicle_make LIKE ?').join(' OR ')})`);
    params.push(...makes);
  }

  if (group?.years) {
    conditions.push('vehicle_year BETWEEN ? AND ?');
    params.push(...group.years);
  }

  if (model !== 'ANY' && !group) {
    const filter = buildModelFilter(make, model);
    conditions.push(filter.condition);
    params.push(...filter.params);
  }

  const yearData = parseYearInput(yearInput);
  if (yearData.conditions) {
    conditions.push(`(${yearData.conditions})`);
    params.push(...yearData.params);
  }
  const sql = `SELECT * FROM vehicles WHERE ${conditions.join(' AND ')}`;
  const rows = await queryAll(sql, params, 'Failed to query vehicles:');
  // ponytail: opt-in groups filter the make/year/yard/status subset in JS;
  // index materialized family IDs if this bounded scan ever becomes expensive.
  return group
    ? rows.filter((row) => group.pattern.test(normalizeModelForLooseComparison(row.vehicle_model)))
    : rows;
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
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : 8;
  const yardIds = parseYardIds(yardId);

  let sql = `
    SELECT vehicle_model AS model, COUNT(*) AS count
    FROM vehicles
    WHERE 1 = 1
  `;
  const params = [];

  if (normalizedMake !== 'ANY' && normalizedMake !== '') {
    const makes = getMakeVariations(normalizedMake);
    sql += ` AND (${makes.map(() => 'vehicle_make LIKE ?').join(' OR ')})`;
    params.push(...makes);
  }

  if (yardId !== 'ALL' && Array.isArray(yardIds) && yardIds.length > 0) {
    sql += ` AND yard_id IN (${yardIds.map(() => '?').join(', ')})`;
    params.push(...yardIds);
  }

  sql += `
    GROUP BY vehicle_model
    ORDER BY count DESC, vehicle_model ASC
  `;

  return queryAll(
    sql,
    params,
    'Failed to query no-result model suggestions:'
  ).then((rows) => {
    const rankedRows = [
      ...(rows || []),
      ...getModelFamilyNames(normalizedMake).map((model) => ({ model, count: 0 })),
    ]
      // Discord choice labels/values cannot exceed 100 characters. Never truncate a filter.
      .filter((row) => typeof row.model === 'string' && row.model.length <= 100 &&
        normalizeModelForLooseComparison(row.model) !== '')
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
      const key = normalizeModelForLooseComparison(row.model);
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
  // Historical models remain selectable even when no matching vehicle is active.
  return getModelSuggestionsForNoResults(make, partialModel, 'ALL', limit)
    .then((models) => models.map((model) => ({ model })));
}

module.exports = {
  db,
  getModelSuggestions,
  getModelSuggestionsForNoResults,
  queryVehicles,
};
