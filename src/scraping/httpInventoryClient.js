const {
  buildSubmissionPayload,
  extractResultRows,
  normalizeSearchValue,
  resolveFormMeta,
  uniqueNonEmptyStrings,
} = require('./httpInventoryParser');
const { summarizeError } = require('../utils/errorSummary');
const {
  logHttpDebug,
  requestJson,
  requestPage,
} = require('./httpInventoryTransport');

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
      count: makes.length,
    });
    return makes;
  } catch (error) {
    if (runState) runState.hadSoftFailure = true;
    logHttpDebug('fetchMakesForYard failed', {
      error: summarizeError(error),
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
      count: models.length,
    });
    return models;
  } catch (error) {
    if (runState) runState.hadSoftFailure = true;
    logHttpDebug('fetchModelsForMake failed', {
      error: summarizeError(error),
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
  logHttpDebug('submitSearch payload prepared', {
    method: String(formMeta.method || 'GET').toUpperCase(),
    fieldCount: Object.keys(payload).length,
  });
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
  fetchMakesForYard,
  fetchModelsForMake,
  loadInitialInventoryPage,
  submitSearch,
};
