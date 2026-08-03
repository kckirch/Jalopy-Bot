const MAX_LIMIT = 10000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeStatus(value) {
  const normalized = normalizeUpper(value);
  if (normalized === 'NEW' || normalized === 'INACTIVE') {
    return normalized;
  }
  return normalized === 'ACTIVE' ? 'ACTIVE' : '';
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function addYardFilter(searchParams, conditions, params) {
  const yards = parseList(searchParams.get('yard')).map(normalizeUpper);
  if (yards.length === 0) return;

  conditions.push(`UPPER(yard_name) IN (${yards.map(() => '?').join(',')})`);
  params.push(...yards);
}

function addTextFilter(searchParams, name, column, conditions, params) {
  const value = normalizeUpper(searchParams.get(name));
  if (!value) return;
  conditions.push(`UPPER(${column}) = ?`);
  params.push(value);
}

function addStatusFilter(searchParams, conditions) {
  const status = normalizeStatus(searchParams.get('status'));
  if (status === 'ACTIVE') {
    conditions.push("vehicle_status IN ('ACTIVE', 'NEW')");
  } else if (status === 'NEW') {
    conditions.push("vehicle_status = 'NEW'");
  } else if (status === 'INACTIVE') {
    conditions.push("vehicle_status = 'INACTIVE'");
  }
}

function addYearFilters(searchParams, conditions, params) {
  const year = searchParams.get('year');
  if (year && /^\d{4}$/.test(year)) {
    conditions.push('vehicle_year = ?');
    params.push(Number.parseInt(year, 10));
  }

  const yearStart = searchParams.get('yearStart');
  const yearEnd = searchParams.get('yearEnd');
  if (
    !yearStart ||
    !yearEnd ||
    !/^\d{4}$/.test(yearStart) ||
    !/^\d{4}$/.test(yearEnd)
  ) {
    return;
  }

  const start = Number.parseInt(yearStart, 10);
  const end = Number.parseInt(yearEnd, 10);
  if (start <= end) {
    conditions.push('vehicle_year BETWEEN ? AND ?');
    params.push(start, end);
  }
}

function buildVehicleQuery(searchParams) {
  const params = [];
  const conditions = [];

  addYardFilter(searchParams, conditions, params);
  addTextFilter(searchParams, 'make', 'vehicle_make', conditions, params);
  addTextFilter(searchParams, 'model', 'vehicle_model', conditions, params);
  addStatusFilter(searchParams, conditions);
  addYearFilters(searchParams, conditions, params);

  const limit = Math.min(
    parsePositiveInt(searchParams.get('limit'), MAX_LIMIT),
    MAX_LIMIT
  );
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT
      id,
      yard_id AS yardId,
      yard_name AS yardName,
      vehicle_make AS make,
      vehicle_model AS model,
      vehicle_year AS year,
      row_number AS rowNumber,
      vehicle_status AS status,
      first_seen AS firstSeen,
      last_seen AS lastSeen,
      date_added AS dateAdded,
      last_updated AS lastUpdated,
      notes
    FROM vehicles
    ${whereClause}
    ORDER BY last_updated DESC, id DESC
    LIMIT ?
  `;

  params.push(limit);
  return { sql, params, limit };
}

module.exports = {
  buildVehicleQuery,
  parseList,
  parsePositiveInt,
};
