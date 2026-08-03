const {
  insertOrUpdateVehicle,
  markInactiveVehicles,
} = require('../database/vehicleDbInventoryManager');
const {
  fetchMakesForYard,
  fetchModelsForMake,
  loadInitialInventoryPage,
  submitSearch,
} = require('./httpInventoryClient');
const { createHttpClientState } = require('./httpInventoryTransport');
const {
  extractOptionValues,
  extractResultRows,
  normalizeSearchValue,
} = require('./httpInventoryParser');
const {
  createScrapeRun,
  logScrapeDuration,
  logScrapeRequest,
  reconcileScrapeRun,
} = require('./scrapeLifecycle');
const { logScrapeYardResult } = require('./scrapeLogging');

async function scrapeMakeModelHttp(
  clientState,
  context,
  yardId,
  make,
  model,
  sessionID
) {
  const result = await submitSearch(
    clientState,
    context.inventoryUrl,
    context.formMeta,
    {
      yardId,
      make,
      model,
      hasMultipleLocations: context.hasMultipleLocations,
    }
  );
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
      sessionID
    );
  }

  return rows.length;
}

async function scrapeModelsForMake(
  clientState,
  context,
  yardId,
  make,
  requestedModel,
  sessionID
) {
  let models = [requestedModel];
  if (requestedModel === 'ANY') {
    models = await fetchModelsForMake(
      clientState,
      context.inventoryUrl,
      yardId,
      make,
      context.runState,
      { hasMultipleLocations: context.hasMultipleLocations }
    );
    if (models.length === 0) models = [''];
  }

  let rowCount = 0;
  for (const model of models) {
    rowCount += await scrapeMakeModelHttp(
      clientState,
      context,
      yardId,
      make,
      model,
      sessionID
    );
  }
  return rowCount;
}

async function scrapeAllMakes(
  clientState,
  context,
  yardId,
  model,
  sessionID,
  basePage
) {
  let makeValues = [];
  if (context.hasMultipleLocations) {
    makeValues = await fetchMakesForYard(
      clientState,
      context.inventoryUrl,
      yardId,
      context.runState
    );
  }

  if (makeValues.length === 0) {
    makeValues = extractOptionValues(basePage.$, '#car-make');
  }

  let totalRows = 0;
  for (const currentMake of makeValues) {
    totalRows += await scrapeModelsForMake(
      clientState,
      context,
      yardId,
      currentMake,
      model,
      sessionID
    );
  }

  if (makeValues.length === 0) {
    totalRows += await scrapeMakeModelHttp(
      clientState,
      context,
      yardId,
      'ANY',
      normalizeSearchValue(model),
      sessionID
    );
  }

  return totalRows;
}

async function scrapeYardMakeModelHttp(
  clientState,
  context,
  yardId,
  make,
  model,
  sessionID
) {
  const basePage = await submitSearch(
    clientState,
    context.inventoryUrl,
    context.formMeta,
    {
      yardId,
      make,
      hasMultipleLocations: context.hasMultipleLocations,
    }
  );
  context.formMeta = basePage.formMeta;

  const rowCount =
    make === 'ANY'
      ? await scrapeAllMakes(
          clientState,
          context,
          yardId,
          model,
          sessionID,
          basePage
        )
      : await scrapeModelsForMake(
          clientState,
          context,
          yardId,
          make,
          model,
          sessionID
        );

  logScrapeYardResult(yardId, rowCount);
  return rowCount;
}

function resolveYardIdsToScrape(options, initialPage) {
  if (!options.hasMultipleLocations) {
    return [options.yardId];
  }
  if (options.yardId) {
    return [options.yardId];
  }
  return extractOptionValues(initialPage.$, '#yard-id');
}

async function scrapeWithHttp(options, dependencies = {}) {
  const upsertVehicle =
    dependencies.insertOrUpdateVehicle || insertOrUpdateVehicle;
  const reconcileInactiveVehicles =
    dependencies.markInactiveVehicles || markInactiveVehicles;
  const run = createScrapeRun(upsertVehicle);
  const runState = { hadSoftFailure: false };

  try {
    logScrapeRequest(options);
    const clientState = createHttpClientState(dependencies);

    const initialPage = await loadInitialInventoryPage(
      clientState,
      options.inventoryUrl
    );
    const yardIdsToScrape = resolveYardIdsToScrape(options, initialPage);
    if (!yardIdsToScrape.length) {
      throw new Error('No yard IDs discovered for scraping.');
    }

    const context = {
      inventoryUrl: options.inventoryUrl,
      hasMultipleLocations: options.hasMultipleLocations === true,
      formMeta: initialPage.formMeta,
      upsertVehicle: run.upsertVehicle,
      runState,
    };

    for (const yardId of yardIdsToScrape) {
      run.trackYard(yardId);
      await scrapeYardMakeModelHttp(
        clientState,
        context,
        yardId,
        options.make,
        options.model,
        options.sessionID
      );
    }

    run.markSucceeded();
  } finally {
    await reconcileScrapeRun(run, options, reconcileInactiveVehicles, {
      hadSoftFailure: runState.hadSoftFailure,
    });
    logScrapeDuration(run.startedAt);
  }
}

module.exports = { scrapeWithHttp };
