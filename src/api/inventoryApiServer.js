const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { VEHICLE_DB_PATH } = require('../database/dbPath');
const { createPublicInventorySnapshotProvider } = require('./publicInventorySnapshot');

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';
const MAX_LIMIT = 10000;
const DEFAULT_DB_CACHE_SECONDS = 3600;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeStatus(value) {
  const normalized = normalizeUpper(value);
  if (normalized === 'NEW' || normalized === 'INACTIVE') {
    return normalized;
  }
  if (normalized === 'ACTIVE') {
    return 'ACTIVE';
  }
  return '';
}

function parseList(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildCorsHeaders(origin, allowedOrigins) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, If-None-Match, If-Modified-Since',
  };

  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }

  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }

  return headers;
}

function writeJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request, apiKey) {
  if (!apiKey) {
    return true;
  }
  return request.headers['x-api-key'] === apiKey;
}

function buildVehicleQuery(searchParams) {
  const params = [];
  const conditions = [];

  const yards = parseList(searchParams.get('yard')).map((yard) => normalizeUpper(yard));
  if (yards.length > 0) {
    conditions.push(`UPPER(yard_name) IN (${yards.map(() => '?').join(',')})`);
    params.push(...yards);
  }

  const make = normalizeUpper(searchParams.get('make'));
  if (make) {
    conditions.push('UPPER(vehicle_make) = ?');
    params.push(make);
  }

  const model = normalizeUpper(searchParams.get('model'));
  if (model) {
    conditions.push('UPPER(vehicle_model) = ?');
    params.push(model);
  }

  const status = normalizeStatus(searchParams.get('status'));
  if (status === 'ACTIVE') {
    conditions.push("vehicle_status IN ('ACTIVE', 'NEW')");
  } else if (status === 'NEW') {
    conditions.push("vehicle_status = 'NEW'");
  } else if (status === 'INACTIVE') {
    conditions.push("vehicle_status = 'INACTIVE'");
  }

  const year = searchParams.get('year');
  if (year && /^\d{4}$/.test(year)) {
    conditions.push('vehicle_year = ?');
    params.push(Number.parseInt(year, 10));
  }

  const yearStart = searchParams.get('yearStart');
  const yearEnd = searchParams.get('yearEnd');
  if (yearStart && yearEnd && /^\d{4}$/.test(yearStart) && /^\d{4}$/.test(yearEnd)) {
    const start = Number.parseInt(yearStart, 10);
    const end = Number.parseInt(yearEnd, 10);
    if (start <= end) {
      conditions.push('vehicle_year BETWEEN ? AND ?');
      params.push(start, end);
    }
  }

  const limit = Math.min(parsePositiveInt(searchParams.get('limit'), MAX_LIMIT), MAX_LIMIT);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

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

  return {
    sql,
    params,
    limit,
  };
}

function buildDbEtag(stat) {
  return `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
}

function isNotModified(request, etag, lastModifiedMillis) {
  const ifNoneMatch = String(request.headers['if-none-match'] || '').trim();
  if (ifNoneMatch) {
    const candidates = ifNoneMatch.split(',').map((item) => item.trim());
    if (candidates.includes('*') || candidates.includes(etag)) {
      return true;
    }
  }

  const ifModifiedSince = request.headers['if-modified-since'];
  if (ifModifiedSince) {
    const sinceMillis = Date.parse(ifModifiedSince);
    if (!Number.isNaN(sinceMillis) && sinceMillis >= Math.floor(lastModifiedMillis)) {
      return true;
    }
  }

  return false;
}

async function sendVehicleDbFile(
  request,
  response,
  corsHeaders,
  dbCacheSeconds,
  snapshotProvider
) {
  let fileHandle;

  try {
    const snapshot = await snapshotProvider.getSnapshot();
    fileHandle = await fs.promises.open(snapshot.path, 'r');
    const stat = await fileHandle.stat();

    const etag = buildDbEtag(stat);
    const lastModified = new Date(stat.mtimeMs).toUTCString();
    const sharedHeaders = {
      ...corsHeaders,
      ETag: etag,
      'Last-Modified': lastModified,
      'Cache-Control': `public, max-age=${dbCacheSeconds}, stale-while-revalidate=${dbCacheSeconds * 2}`,
    };

    if (isNotModified(request, etag, stat.mtimeMs)) {
      await fileHandle.close();
      fileHandle = null;
      response.writeHead(304, sharedHeaders);
      response.end();
      return;
    }

    response.writeHead(200, {
      ...sharedHeaders,
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Length': stat.size,
      'X-Inventory-Snapshot': 'public-vehicles-only',
    });

    if (request.method === 'HEAD') {
      await fileHandle.close();
      fileHandle = null;
      response.end();
      return;
    }

    const stream = fileHandle.createReadStream();
    fileHandle = null;
    stream.on('error', (streamError) => {
      console.error('[inventory-api] failed to stream public vehicle snapshot:', streamError);
      if (!response.headersSent) {
        writeJson(response, 500, { error: 'Failed to stream database file' }, corsHeaders);
      } else {
        response.destroy(streamError);
      }
    });
    stream.pipe(response);
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    console.error('[inventory-api] failed to build public vehicle snapshot:', error);
    if (!response.headersSent) {
      writeJson(response, 500, { error: 'Database snapshot not available' }, corsHeaders);
    } else {
      response.destroy(error);
    }
  }
}

function startInventoryApiServer(options = {}) {
  const host = options.host || process.env.INVENTORY_API_HOST || DEFAULT_HOST;
  const port = parsePositiveInt(options.port || process.env.INVENTORY_API_PORT, DEFAULT_PORT);
  const apiKey = options.apiKey || process.env.INVENTORY_API_KEY || '';
  const allowedOrigins = parseList(options.allowedOrigins || process.env.INVENTORY_API_ALLOWED_ORIGINS || '*');
  const dbCacheSeconds = parsePositiveInt(
    options.dbCacheSeconds || process.env.INVENTORY_DB_CACHE_SECONDS,
    DEFAULT_DB_CACHE_SECONDS
  );
  const vehicleDbPath = options.dbPath || VEHICLE_DB_PATH;
  const ownsSnapshotDirectory = !options.publicSnapshotDirectory;
  const publicSnapshotDirectory =
    options.publicSnapshotDirectory ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-public-inventory-'));
  const publicSnapshotPath = path.join(publicSnapshotDirectory, 'vehicleInventory.db');

  const db = new sqlite3.Database(vehicleDbPath, sqlite3.OPEN_READONLY, (error) => {
    if (error) {
      console.error('[inventory-api] failed to open configured database:', error);
    } else {
      console.log('[inventory-api] using configured database');
    }
  });
  const snapshotProvider =
    options.snapshotProvider ||
    createPublicInventorySnapshotProvider({
      sourceDatabase: db,
      sourcePath: vehicleDbPath,
      snapshotPath: publicSnapshotPath,
      onRefreshError: (error) => {
        console.error('[inventory-api] failed to refresh public vehicle snapshot:', error);
      },
    });

  const server = http.createServer((request, response) => {
    const origin = request.headers.origin || '';
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      writeJson(response, 200, { ok: true, service: 'inventory-api' }, corsHeaders);
      return;
    }

    if (url.pathname === '/api/vehicle-db' && (request.method === 'GET' || request.method === 'HEAD')) {
      if (!isAuthorized(request, apiKey)) {
        writeJson(response, 401, { error: 'Unauthorized' }, corsHeaders);
        return;
      }
      sendVehicleDbFile(
        request,
        response,
        corsHeaders,
        dbCacheSeconds,
        snapshotProvider
      );
      return;
    }

    if (url.pathname === '/api/vehicles' && request.method === 'GET') {
      if (!isAuthorized(request, apiKey)) {
        writeJson(response, 401, { error: 'Unauthorized' }, corsHeaders);
        return;
      }

      const { sql, params, limit } = buildVehicleQuery(url.searchParams);

      db.all(sql, params, (error, rows) => {
        if (error) {
          console.error('[inventory-api] query failed:', error);
          writeJson(response, 500, { error: 'Query failed' }, corsHeaders);
          return;
        }

        writeJson(
          response,
          200,
          {
            count: rows.length,
            limit,
            rows,
            fetchedAt: new Date().toISOString(),
          },
          corsHeaders
        );
      });
      return;
    }

    writeJson(response, 404, { error: 'Not found' }, corsHeaders);
  });

  server.listen(port, host, () => {
    console.log(`[inventory-api] listening on http://${host}:${port}`);

    Promise.resolve()
      .then(() => {
        if (typeof snapshotProvider.refreshSnapshot === 'function') {
          return snapshotProvider.refreshSnapshot();
        }
        return snapshotProvider.getSnapshot();
      })
      .then((snapshot) => {
        console.log(
          `[inventory-api] public snapshot ready with ${snapshot.vehicleCount} vehicles`
        );
      })
      .catch((error) => {
        console.error('[inventory-api] failed to prewarm public vehicle snapshot:', error);
      });
  });

  const shutdown = () => {
    server.close(() => {
      db.close(() => {
        if (ownsSnapshotDirectory) {
          fs.rmSync(publicSnapshotDirectory, { recursive: true, force: true });
        }
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

if (require.main === module) {
  startInventoryApiServer();
}

module.exports = {
  startInventoryApiServer,
  __testables: {
    buildVehicleQuery,
    normalizeStatus,
    parseList,
    buildDbEtag,
  },
};
