const crypto = require('node:crypto');
const fs = require('node:fs');
const { summarizeError } = require('../utils/errorSummary');
const { buildVehicleQuery } = require('./inventoryApiQuery');

function buildCorsHeaders(origin, allowedOrigins) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, X-API-Key, If-None-Match, If-Modified-Since',
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
  const providedApiKey = request.headers['x-api-key'];
  if (
    typeof apiKey !== 'string' ||
    apiKey.length === 0 ||
    typeof providedApiKey !== 'string'
  ) {
    return false;
  }

  const expected = Buffer.from(apiKey);
  const provided = Buffer.from(providedApiKey);
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function buildDbEtag(stat) {
  return `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
}

function isNotModified(request, etag, lastModifiedMillis) {
  const ifNoneMatch = String(request.headers['if-none-match'] || '').trim();
  if (ifNoneMatch) {
    const candidates = ifNoneMatch.split(',').map((item) => item.trim());
    return candidates.includes('*') || candidates.includes(etag);
  }

  const ifModifiedSince = request.headers['if-modified-since'];
  if (ifModifiedSince) {
    const sinceMillis = Date.parse(ifModifiedSince);
    if (
      !Number.isNaN(sinceMillis) &&
      sinceMillis >= Math.floor(lastModifiedMillis / 1000) * 1000
    ) {
      return true;
    }
  }
  return false;
}

function parseRequestUrl(requestUrl) {
  if (typeof requestUrl !== 'string') return null;

  try {
    return new URL(requestUrl, 'http://localhost');
  } catch {
    return null;
  }
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
      console.error(
        '[inventory-api] failed to stream public vehicle snapshot:',
        summarizeError(streamError)
      );
      if (!response.headersSent) {
        writeJson(
          response,
          500,
          { error: 'Failed to stream database file' },
          corsHeaders
        );
      } else {
        response.destroy(streamError);
      }
    });
    stream.pipe(response);
  } catch (error) {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    console.error(
      '[inventory-api] failed to build public vehicle snapshot:',
      summarizeError(error)
    );
    if (!response.headersSent) {
      writeJson(
        response,
        500,
        { error: 'Database snapshot not available' },
        corsHeaders
      );
    } else {
      response.destroy(error);
    }
  }
}

function sendVehicleQuery(response, corsHeaders, db, searchParams) {
  const { sql, params, limit } = buildVehicleQuery(searchParams);
  db.all(sql, params, (error, rows) => {
    if (error) {
      console.error('[inventory-api] query failed:', summarizeError(error));
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
}

function createInventoryApiRequestHandler({
  allowedOrigins,
  apiKey,
  db,
  dbCacheSeconds,
  snapshotProvider,
}) {
  return (request, response) => {
    const origin = request.headers.origin || '';
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = parseRequestUrl(request.url);
    if (!url) {
      writeJson(response, 400, { error: 'Bad request' }, corsHeaders);
      return;
    }

    if (
      url.pathname === '/health' &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      writeJson(
        response,
        200,
        { ok: true, service: 'inventory-api' },
        corsHeaders
      );
      return;
    }

    if (
      url.pathname === '/api/vehicle-db' &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
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
      sendVehicleQuery(response, corsHeaders, db, url.searchParams);
      return;
    }

    writeJson(response, 404, { error: 'Not found' }, corsHeaders);
  };
}

module.exports = {
  createInventoryApiRequestHandler,
  sendVehicleDbFile,
};
