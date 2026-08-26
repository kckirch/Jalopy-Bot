const DEFAULT_HEADERS = Object.freeze({
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
});

function isHttpDebugEnabled() {
  const value = String(process.env.SCRAPER_HTTP_DEBUG || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function logHttpDebug(message, details) {
  if (isHttpDebugEnabled()) console.log(`[http-debug] ${message}`, details);
}

function mergeCookieHeaders(existingCookieHeader, setCookieHeaders) {
  const jar = new Map();
  const addCookie = (line) => {
    const cookiePair = String(line || '').split(';')[0];
    const separatorIndex = cookiePair.indexOf('=');
    if (separatorIndex <= 0) return;
    jar.set(
      cookiePair.slice(0, separatorIndex).trim(),
      cookiePair.slice(separatorIndex + 1).trim()
    );
  };

  String(existingCookieHeader || '').split(';').forEach(addCookie);
  for (const header of setCookieHeaders || []) addCookie(header);
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function loadCheerio(dependencies) {
  if (dependencies.cheerio) return dependencies.cheerio;
  try {
    return (dependencies.loadCheerio || (() => require('cheerio')))();
  } catch (error) {
    throw new Error(
      'HTTP scraper requires cheerio. Install it with: npm install cheerio',
      { cause: error }
    );
  }
}

function createHttpClientState(dependencies = {}) {
  return {
    cheerio: loadCheerio(dependencies),
    fetch: dependencies.fetch || globalThis.fetch,
    cookieHeader: '',
  };
}

function buildHeaders(clientState, extraHeaders = {}) {
  const headers = { ...DEFAULT_HEADERS, ...extraHeaders };
  if (clientState.cookieHeader) headers.Cookie = clientState.cookieHeader;
  return headers;
}

function updateCookies(clientState, headers) {
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  clientState.cookieHeader = mergeCookieHeaders(
    clientState.cookieHeader,
    setCookies
  );
}

async function sendRequest(
  clientState,
  { method = 'GET', url, payload = {}, headers = {} }
) {
  const requestMethod = method.toUpperCase();
  const requestUrl = new URL(url);
  const options = {
    method: requestMethod,
    headers: buildHeaders(clientState, headers),
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  };

  if (requestMethod === 'GET') {
    for (const [name, value] of Object.entries(payload)) {
      requestUrl.searchParams.set(name, value);
    }
  } else {
    options.body = new URLSearchParams(payload).toString();
  }

  return clientState.fetch(requestUrl, options);
}

async function requestPage(clientState, { method, url, payload }) {
  const isGet = String(method || 'GET').toUpperCase() === 'GET';
  const response = await sendRequest(clientState, {
    method,
    url,
    payload,
    headers: isGet
      ? {}
      : { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Page request failed with status ${response.status} for ${url}`);
  }
  updateCookies(clientState, response.headers);
  return response.text();
}

async function requestJson(clientState, { url, payload, runState }) {
  const response = await sendRequest(clientState, {
    method: 'POST',
    url,
    payload,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
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
  const body = (await response.text()).trim();
  if (!body) return [];
  try {
    const data = JSON.parse(body);
    return Array.isArray(data) ? data : [];
  } catch {
    if (runState) runState.hadSoftFailure = true;
    return [];
  }
}

module.exports = {
  createHttpClientState,
  logHttpDebug,
  requestJson,
  requestPage,
};
