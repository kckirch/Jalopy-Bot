function isHttpDebugEnabled() {
  const value = String(process.env.SCRAPER_HTTP_DEBUG || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function logHttpDebug(message, details) {
  if (!isHttpDebugEnabled()) return;
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
  const cheerio = loadCheerio(dependencies);
  const httpClient =
    dependencies.httpClient ||
    loadAxios(dependencies).create({
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

function buildRequestHeaders(clientState, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (clientState.cookieHeader) {
    headers.Cookie = clientState.cookieHeader;
  }
  return headers;
}

function updateCookies(clientState, responseHeaders) {
  const normalizedHeaders = normalizeHeaders(responseHeaders || {});
  clientState.cookieHeader = mergeCookieHeaders(
    clientState.cookieHeader,
    normalizedHeaders['set-cookie']
  );
}

async function requestPage(clientState, { method, url, payload }) {
  const requestConfig = {
    method: String(method || 'GET').toUpperCase(),
    url,
    headers: buildRequestHeaders(clientState),
  };

  if (requestConfig.method === 'GET') {
    requestConfig.params = payload;
  } else {
    requestConfig.headers['Content-Type'] =
      'application/x-www-form-urlencoded';
    requestConfig.data = new URLSearchParams(payload).toString();
  }

  const response = await clientState.httpClient.request(requestConfig);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Page request failed with status ${response.status} for ${url}`);
  }
  updateCookies(clientState, response.headers);
  return String(response.data || '');
}

async function requestJson(clientState, { url, payload, runState }) {
  const response = await clientState.httpClient.request({
    method: 'POST',
    url,
    headers: buildRequestHeaders(clientState, {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    }),
    data: new URLSearchParams(payload).toString(),
  });
  logHttpDebug('requestJson response', {
    status: response.status,
    fieldCount: Object.keys(payload).length,
  });

  if (response.status < 200 || response.status >= 300) {
    if (runState) runState.hadSoftFailure = true;
    throw new Error(`JSON request failed with status ${response.status} for ${url}`);
  }

  updateCookies(clientState, response.headers);

  if (typeof response.data === 'string') {
    const trimmed = response.data.trim();
    if (!trimmed) return [];
    try {
      return JSON.parse(trimmed);
    } catch {
      if (runState) runState.hadSoftFailure = true;
      return [];
    }
  }

  return Array.isArray(response.data) ? response.data : [];
}

module.exports = {
  createHttpClientState,
  logHttpDebug,
  requestJson,
  requestPage,
};
