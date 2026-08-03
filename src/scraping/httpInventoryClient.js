const {
  buildSubmissionPayload,
  extractResultRows,
  normalizeSearchValue,
  resolveFormMeta,
  uniqueNonEmptyStrings,
} = require('./httpInventoryParser');

function isHttpDebugEnabled() {
  const value = String(process.env.SCRAPER_HTTP_DEBUG || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function logHttpDebug(message, details = null) {
  if (!isHttpDebugEnabled()) return;
  if (details == null) {
    console.log(`[http-debug] ${message}`);
    return;
  }
  console.log(`[http-debug] ${message}`, details);
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

function mergeCookieHeaders(existingCookieHeader, setCookieHeaders) {
  const jar = new Map();
  const ingestCookieLine = (line) => {
    if (!line) return;
    const [cookiePair] = String(line).split(';');
    if (!cookiePair) return;
    const separatorIndex = cookiePair.indexOf('=');
    if (separatorIndex <= 0) return;
    const name = cookiePair.slice(0, separatorIndex).trim();
    const value = cookiePair.slice(separatorIndex + 1).trim();
    if (!name) return;
    jar.set(name, value);
  };

  String(existingCookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach(ingestCookieLine);

  const setCookieList = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  setCookieList.forEach(ingestCookieLine);

  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function loadAxios(dependencies) {
  if (dependencies.axios) return dependencies.axios;
  try {
    const loader = dependencies.loadAxios || (() => require('axios'));
    return loader();
  } catch (error) {
    throw new Error(
      'HTTP scraper requires axios. Install it with: npm install axios',
      { cause: error }
    );
  }
}

function loadCheerio(dependencies) {
  if (dependencies.cheerio) return dependencies.cheerio;
  try {
    const loader = dependencies.loadCheerio || (() => require('cheerio'));
    return loader();
  } catch (error) {
    throw new Error(
      'HTTP scraper requires cheerio. Install it with: npm install cheerio',
      { cause: error }
    );
  }
}

function createHttpClientState(dependencies = {}) {
  const axios = loadAxios(dependencies);
  const cheerio = loadCheerio(dependencies);
  const httpClient =
    dependencies.httpClient ||
    axios.create({
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 500,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

  return {
    httpClient,
    cheerio,
    cookieHeader: '',
  };
}

async function requestPage(clientState, { method, url, payload }) {
  const headers = {};
  if (clientState.cookieHeader) {
    headers.Cookie = clientState.cookieHeader;
  }

  const requestConfig = {
    method: String(method || 'GET').toUpperCase(),
    url,
    headers,
  };

  if (requestConfig.method === 'GET') {
    requestConfig.params = payload;
  } else {
    requestConfig.headers['Content-Type'] =
      'application/x-www-form-urlencoded';
    requestConfig.data = new URLSearchParams(payload).toString();
  }

  const response = await clientState.httpClient.request(requestConfig);
  const normalizedHeaders = normalizeHeaders(response.headers || {});
  clientState.cookieHeader = mergeCookieHeaders(
    clientState.cookieHeader,
    normalizedHeaders['set-cookie']
  );
  return String(response.data || '');
}

async function requestJson(clientState, { url, payload, runState }) {
  const headers = {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (clientState.cookieHeader) {
    headers.Cookie = clientState.cookieHeader;
  }

  const response = await clientState.httpClient.request({
    method: 'POST',
    url,
    headers,
    data: new URLSearchParams(payload).toString(),
  });
  logHttpDebug('requestJson response', {
    url,
    status: response.status,
    payload,
  });

  if (response.status < 200 || response.status >= 300) {
    if (runState) runState.hadSoftFailure = true;
    throw new Error(`JSON request failed with status ${response.status} for ${url}`);
  }

  const normalizedHeaders = normalizeHeaders(response.headers || {});
  clientState.cookieHeader = mergeCookieHeaders(
    clientState.cookieHeader,
    normalizedHeaders['set-cookie']
  );

  if (typeof response.data === 'string') {
    const trimmed = response.data.trim();
    if (!trimmed) return [];
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      if (runState) runState.hadSoftFailure = true;
      return [];
    }
  }

  return Array.isArray(response.data) ? response.data : [];
}

async function fetchMakesForYard(
  clientState,
  inventoryUrl,
  yardId,
  runState
) {
  try {
    const url = new URL('/Home/GetMakes', inventoryUrl).toString();
    const data = await requestJson(clientState, {
      url,
      payload: { yardId: String(yardId) },
      runState,
    });
    const makes = uniqueNonEmptyStrings(
      data.map((item) => item && item.makeName)
    );
    logHttpDebug('makes discovered', {
      yardId: String(yardId),
      count: makes.length,
      sample: makes.slice(0, 5),
    });
    return makes;
  } catch (error) {
    if (runState) runState.hadSoftFailure = true;
    logHttpDebug('fetchMakesForYard failed', {
      yardId: String(yardId),
      error: String(error && error.message ? error.message : error),
    });
    return [];
  }
}

function buildModelsLookupPayload(hasMultipleLocations, yardId, makeName) {
  const payload = { makeName: String(makeName) };
  if (hasMultipleLocations) {
    payload.yardId = String(yardId);
  } else {
    payload.showInventory = true;
  }
  return payload;
}

async function fetchModelsForMake(
  clientState,
  inventoryUrl,
  yardId,
  makeName,
  runState,
  { hasMultipleLocations = false } = {}
) {
  if (!normalizeSearchValue(makeName)) return [];

  try {
    const url = new URL('/Home/GetModels', inventoryUrl).toString();
    const payload = buildModelsLookupPayload(
      hasMultipleLocations,
      yardId,
      makeName
    );
    const data = await requestJson(clientState, { url, payload, runState });
    const models = uniqueNonEmptyStrings(
      data.map((item) => {
        if (!item) return '';
        return item.model || item.modelName || '';
      })
    );
    logHttpDebug('models discovered', {
      yardId: String(yardId),
      makeName: String(makeName),
      count: models.length,
      sample: models.slice(0, 8),
    });
    return models;
  } catch (error) {
    if (runState) runState.hadSoftFailure = true;
    logHttpDebug('fetchModelsForMake failed', {
      yardId: String(yardId),
      makeName: String(makeName),
      error: String(error && error.message ? error.message : error),
    });
    return [];
  }
}

async function loadInitialInventoryPage(clientState, inventoryUrl) {
  const html = await requestPage(clientState, {
    method: 'GET',
    url: inventoryUrl,
    payload: {},
  });
  const $ = clientState.cheerio.load(html);
  return {
    $,
    formMeta: resolveFormMeta($, inventoryUrl),
  };
}

async function submitSearch(
  clientState,
  inventoryUrl,
  formMeta,
  submission
) {
  const payload = buildSubmissionPayload(formMeta, submission);
  logHttpDebug('submitSearch payload', payload);
  const html = await requestPage(clientState, {
    method: formMeta.method,
    url: formMeta.actionUrl,
    payload,
  });
  const $ = clientState.cheerio.load(html);
  const nextMeta = resolveFormMeta($, inventoryUrl, formMeta);
  logHttpDebug('submitSearch rows extracted', {
    count: extractResultRows($).length,
  });
  return { $, formMeta: nextMeta };
}

module.exports = {
  createHttpClientState,
  fetchMakesForYard,
  fetchModelsForMake,
  loadInitialInventoryPage,
  submitSearch,
};
