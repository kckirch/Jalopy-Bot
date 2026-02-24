const { insertOrUpdateVehicle, markInactiveVehicles } = require('../database/vehicleDbInventoryManager');

function isHttpDebugEnabled() {
  const value = String(process.env.SCRAPER_HTTP_DEBUG || '').trim().toLowerCase();
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

function normalizeYardId(yardId) {
  const parsed = parseInt(yardId, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

function normalizeSearchValue(value) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized) return '';
  return normalized.toUpperCase() === 'ANY' ? '' : normalized;
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
    .forEach((cookiePart) => {
      const separatorIndex = cookiePart.indexOf('=');
      if (separatorIndex <= 0) return;
      const name = cookiePart.slice(0, separatorIndex).trim();
      const value = cookiePart.slice(separatorIndex + 1).trim();
      if (!name) return;
      jar.set(name, value);
    });

  const setCookieList = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : (setCookieHeaders ? [setCookieHeaders] : []);
  setCookieList.forEach(ingestCookieLine);

  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function resolveFormMeta($, inventoryUrl, previousMeta = null) {
  const form = $('#searchinventory').first().length
    ? $('#searchinventory').first()
    : $('form').first();

  if (!form.length) {
    if (previousMeta) return previousMeta;
    throw new Error('Could not locate inventory search form in HTML response.');
  }

  const method = String(form.attr('method') || 'GET').toUpperCase();
  const action = String(form.attr('action') || '').trim();
  const actionUrl = new URL(action || inventoryUrl, inventoryUrl).toString();

  const hiddenInputs = {};
  form.find('input[type="hidden"][name]').each((index, input) => {
    const name = String($(input).attr('name') || '').trim();
    if (!name) return;
    hiddenInputs[name] = String($(input).attr('value') || '');
  });

  const resolveFieldName = (selector, fallbackName) => {
    const field = form.find(selector).first().length
      ? form.find(selector).first()
      : $(selector).first();
    if (!field.length) return fallbackName;
    return String(field.attr('name') || field.attr('id') || fallbackName).trim() || fallbackName;
  };

  return {
    method,
    actionUrl,
    hiddenInputs,
    fields: {
      yard: resolveFieldName('#yard-id', 'yard-id'),
      make: resolveFieldName('#car-make', 'car-make'),
      model: resolveFieldName('#car-model', 'car-model'),
    },
  };
}

function extractOptionValues($, selector) {
  const values = [];
  $(selector).first().find('option').each((index, option) => {
    const value = String($(option).attr('value') || '').trim();
    if (!value) return;
    values.push(value);
  });
  return values;
}

function extractResultRows($) {
  const rows = [];

  const rowSelector = '.table-responsive table tbody tr, table tbody tr';
  $(rowSelector).each((index, row) => {
    const cols = $(row).find('td');
    if (cols.length < 4) return;

    const year = parseInt($(cols[0]).text().trim(), 10);
    const make = $(cols[1]).text().trim();
    const model = $(cols[2]).text().trim();
    const rowNumber = parseInt($(cols[3]).text().trim(), 10);

    if (Number.isNaN(year) || Number.isNaN(rowNumber) || !make || !model) return;
    rows.push({ year, make, model, rowNumber });
  });

  return rows;
}

function buildSubmissionPayload(formMeta, { yardId, make, model, hasMultipleLocations }) {
  const payload = { ...formMeta.hiddenInputs };
  const normalizedMake = normalizeSearchValue(make);
  const normalizedModel = normalizeSearchValue(model);
  if (hasMultipleLocations && yardId != null) {
    payload[formMeta.fields.yard] = String(yardId);
  }
  if (make != null) {
    payload[formMeta.fields.make] = normalizedMake;
  }
  if (model != null) {
    payload[formMeta.fields.model] = normalizedModel;
  }
  return payload;
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
    requestConfig.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestConfig.data = new URLSearchParams(payload).toString();
  }

  const response = await clientState.httpClient.request(requestConfig);
  const normalizedHeaders = normalizeHeaders(response.headers || {});
  clientState.cookieHeader = mergeCookieHeaders(clientState.cookieHeader, normalizedHeaders['set-cookie']);
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
  logHttpDebug('requestJson response', { url, status: response.status, payload });

  if (response.status < 200 || response.status >= 300) {
    if (runState) {
      runState.hadSoftFailure = true;
    }
    throw new Error(`JSON request failed with status ${response.status} for ${url}`);
  }

  const normalizedHeaders = normalizeHeaders(response.headers || {});
  clientState.cookieHeader = mergeCookieHeaders(clientState.cookieHeader, normalizedHeaders['set-cookie']);

  if (typeof response.data === 'string') {
    const trimmed = response.data.trim();
    if (!trimmed) return [];
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      if (runState) {
        runState.hadSoftFailure = true;
      }
      return [];
    }
  }

  if (Array.isArray(response.data)) return response.data;
  return [];
}

function uniqueNonEmptyStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value == null ? '' : value).trim();
    if (!normalized) continue;
    const key = normalized.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

async function fetchMakesForYard(clientState, inventoryUrl, yardId, runState) {
  try {
    const url = new URL('/Home/GetMakes', inventoryUrl).toString();
    const data = await requestJson(clientState, {
      url,
      payload: { yardId: String(yardId) },
      runState,
    });
    const makes = uniqueNonEmptyStrings(data.map((item) => item && item.makeName));
    logHttpDebug('makes discovered', { yardId: String(yardId), count: makes.length, sample: makes.slice(0, 5) });
    return makes;
  } catch (error) {
    if (runState) {
      runState.hadSoftFailure = true;
    }
    logHttpDebug('fetchMakesForYard failed', { yardId: String(yardId), error: String(error && error.message ? error.message : error) });
    return [];
  }
}

function buildModelsLookupPayload(context, yardId, makeName) {
  const payload = { makeName: String(makeName) };

  if (context.hasMultipleLocations) {
    payload.yardId = String(yardId);
  } else {
    // Trusty's endpoint expects showInventory and does not use yardId.
    payload.showInventory = true;
  }

  return payload;
}

async function fetchModelsForMake(clientState, inventoryUrl, yardId, makeName, runState, options = {}) {
  if (!normalizeSearchValue(makeName)) return [];

  try {
    const url = new URL('/Home/GetModels', inventoryUrl).toString();
    const payload = buildModelsLookupPayload(
      { hasMultipleLocations: options.hasMultipleLocations === true },
      yardId,
      makeName
    );
    const data = await requestJson(clientState, {
      url,
      payload,
      runState,
    });
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
    if (runState) {
      runState.hadSoftFailure = true;
    }
    logHttpDebug('fetchModelsForMake failed', {
      yardId: String(yardId),
      makeName: String(makeName),
      error: String(error && error.message ? error.message : error),
    });
    return [];
  }
}

async function submitSearch(clientState, inventoryUrl, formMeta, submission) {
  const payload = buildSubmissionPayload(formMeta, submission);
  logHttpDebug('submitSearch payload', payload);
  const html = await requestPage(clientState, {
    method: formMeta.method,
    url: formMeta.actionUrl,
    payload,
  });
  const $ = clientState.cheerio.load(html);
  const nextMeta = resolveFormMeta($, inventoryUrl, formMeta);
  logHttpDebug('submitSearch rows extracted', { count: extractResultRows($).length });
  return { $, formMeta: nextMeta };
}

async function scrapeMakeModelHttp(clientState, context, yardId, make, model, sessionID) {
  const result = await submitSearch(clientState, context.inventoryUrl, context.formMeta, {
    yardId,
    make,
    model,
    hasMultipleLocations: context.hasMultipleLocations,
  });
  context.formMeta = result.formMeta;

  const rows = extractResultRows(result.$);
  for (const vehicle of rows) {
    await context.upsertVehicle(
      yardId,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.rowNumber,
      '',
      '',
      sessionID
    );
  }

  return rows.length;
}

async function scrapeYardMakeModelHttp(clientState, context, yardId, make, model, sessionID) {
  console.log(`Scraping yard: ${yardId}, make: ${make}, model: ${model}`);

  const baseResult = await submitSearch(clientState, context.inventoryUrl, context.formMeta, {
    yardId,
    make,
    hasMultipleLocations: context.hasMultipleLocations,
  });
  context.formMeta = baseResult.formMeta;

  if (make === 'ANY') {
    let makeValues = [];
    if (context.hasMultipleLocations) {
      makeValues = await fetchMakesForYard(clientState, context.inventoryUrl, yardId, context.runState);
    }

    if (makeValues.length === 0) {
      makeValues = extractOptionValues(baseResult.$, '#car-make')
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    }

    let totalRows = 0;
    for (const currentMake of makeValues) {
      let makeRows = 0;
      if (model === 'ANY') {
        let modelValues = await fetchModelsForMake(
          clientState,
          context.inventoryUrl,
          yardId,
          currentMake,
          context.runState,
          { hasMultipleLocations: context.hasMultipleLocations }
        );
        if (modelValues.length === 0) {
          modelValues = [''];
        }

        for (const currentModel of modelValues) {
          makeRows += await scrapeMakeModelHttp(clientState, context, yardId, currentMake, currentModel, sessionID);
        }
      } else {
        makeRows += await scrapeMakeModelHttp(clientState, context, yardId, currentMake, model, sessionID);
      }
      totalRows += makeRows;
      console.log(`[scrape] Yard ${yardId} make ${currentMake} rows ${makeRows}`);
    }

    if (makeValues.length === 0) {
      // Some pages do not populate make options server-side for HTTP clients.
      // Fall back to direct ANY submission to avoid silent zero-row runs.
      totalRows += await scrapeMakeModelHttp(clientState, context, yardId, make, normalizeSearchValue(model), sessionID);
    }

    console.log(`HTTP rows processed for yard ${yardId}: ${totalRows}`);
    console.log(`✅ Finished scraping yard: ${yardId}, make: ${make}, model: ${model}`);
    return totalRows;
  } else {
    let count = 0;
    if (model === 'ANY') {
      let modelValues = await fetchModelsForMake(
        clientState,
        context.inventoryUrl,
        yardId,
        make,
        context.runState,
        { hasMultipleLocations: context.hasMultipleLocations }
      );
      if (modelValues.length === 0) {
        modelValues = [''];
      }
      for (const currentModel of modelValues) {
        count += await scrapeMakeModelHttp(clientState, context, yardId, make, currentModel, sessionID);
      }
    } else {
      count = await scrapeMakeModelHttp(clientState, context, yardId, make, model, sessionID);
    }
    console.log(`[scrape] Yard ${yardId} make ${make} rows ${count}`);
    console.log(`HTTP rows processed for yard ${yardId}: ${count}`);
    console.log(`✅ Finished scraping yard: ${yardId}, make: ${make}, model: ${model}`);
    return count;
  }
}

async function scrapeWithHttp(options, deps = {}) {
  const upsertVehicle = deps.insertOrUpdateVehicle || insertOrUpdateVehicle;
  const reconcileInactiveVehicles = deps.markInactiveVehicles || markInactiveVehicles;
  let upsertCount = 0;
  const trackingUpsertVehicle = async (...args) => {
    await upsertVehicle(...args);
    upsertCount += 1;
  };
  const startTime = Date.now();
  const scrapedYardIds = new Set();
  let scrapeSucceeded = false;
  const runState = { hadSoftFailure: false };

  let axiosModule = deps.axios;
  if (!axiosModule) {
    try {
      axiosModule = require('axios');
    } catch (error) {
      throw new Error('HTTP scraper requires axios. Install it with: npm install axios');
    }
  }

  let cheerioModule = deps.cheerio;
  if (!cheerioModule) {
    try {
      cheerioModule = require('cheerio');
    } catch (error) {
      throw new Error('HTTP scraper requires cheerio. Install it with: npm install cheerio');
    }
  }

  const httpClient = deps.httpClient || axiosModule.create({
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 500,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const clientState = {
    httpClient,
    cheerio: cheerioModule,
    cookieHeader: '',
  };

  try {
    console.log('🔍 Scraping for:');
    console.log(`   🏞️ Yard ID: ${options.yardId || 'ALL'}`);
    console.log(`   🚗 Make: ${options.make}`);
    console.log(`   📋 Model: ${options.model}`);

    const initialHtml = await requestPage(clientState, {
      method: 'GET',
      url: options.inventoryUrl,
      payload: {},
    });
    const initial$ = cheerioModule.load(initialHtml);
    let formMeta = resolveFormMeta(initial$, options.inventoryUrl);

    let yardIdsToScrape = [];
    if (options.hasMultipleLocations) {
      if (options.yardId) {
        yardIdsToScrape = [options.yardId];
      } else {
        yardIdsToScrape = extractOptionValues(initial$, '#yard-id');
      }
    } else {
      yardIdsToScrape = [options.yardId];
    }

    if (!yardIdsToScrape.length) {
      throw new Error('No yard IDs discovered for scraping.');
    }

    const context = {
      inventoryUrl: options.inventoryUrl,
      hasMultipleLocations: options.hasMultipleLocations === true,
      formMeta,
      upsertVehicle: trackingUpsertVehicle,
      runState,
    };

    for (const yardId of yardIdsToScrape) {
      const normalizedYardId = normalizeYardId(yardId);
      if (normalizedYardId !== null) {
        scrapedYardIds.add(normalizedYardId);
      }
      await scrapeYardMakeModelHttp(
        clientState,
        context,
        yardId,
        options.make,
        options.model,
        options.sessionID
      );
      formMeta = context.formMeta;
      context.formMeta = formMeta;
    }

    scrapeSucceeded = true;
  } finally {
    try {
      if (
        options.shouldMarkInactive === true
        && scrapeSucceeded
        && !runState.hadSoftFailure
        && scrapedYardIds.size > 0
        && upsertCount > 0
      ) {
        await reconcileInactiveVehicles(options.sessionID, { yardIds: [...scrapedYardIds] });
      } else {
        console.log(
          `Skipping inactive reconciliation. shouldMarkInactive=${options.shouldMarkInactive === true}, scrapeSucceeded=${scrapeSucceeded}, softFailure=${runState.hadSoftFailure}, scopedYards=${scrapedYardIds.size}, upserts=${upsertCount}`
        );
      }
    } catch (markInactiveError) {
      console.error('Error during inactive reconciliation:', markInactiveError);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(0);
    console.log(`Scraping Duration: ${minutes} minutes and ${seconds} seconds.`);
  }
}

module.exports = {
  scrapeWithHttp,
  __testables: {
    normalizeYardId,
    normalizeSearchValue,
    mergeCookieHeaders,
    resolveFormMeta,
    extractOptionValues,
    extractResultRows,
    buildSubmissionPayload,
    uniqueNonEmptyStrings,
  },
};
