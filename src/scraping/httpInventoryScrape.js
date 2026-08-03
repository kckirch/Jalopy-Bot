const {
  insertOrUpdateVehicle,
  markInactiveVehicles,
} = require('../database/vehicleDbInventoryManager');
const {
  createHttpClientState,
  fetchMakesForYard,
  fetchModelsForMake,
  loadInitialInventoryPage,
  submitSearch,
} = require('./httpInventoryClient');
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
    makeValues = extractOptionValues(basePage.$, '#car-make')
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
      if (modelValues.length === 0) modelValues = [''];

      for (const currentModel of modelValues) {
        makeRows += await scrapeMakeModelHttp(
          clientState,
          context,
          yardId,
          currentMake,
          currentModel,
          sessionID
        );
      }
    } else {
      makeRows += await scrapeMakeModelHttp(
        clientState,
        context,
        yardId,
        currentMake,
        model,
        sessionID
      );
    }
    totalRows += makeRows;
    console.log(`[scrape] Yard ${yardId} make ${currentMake} rows ${makeRows}`);
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

async function scrapeSelectedMake(
  clientState,
  context,
  yardId,
  make,
  model,
  sessionID
) {
  if (model !== 'ANY') {
    return scrapeMakeModelHttp(
      clientState,
      context,
      yardId,
      make,
      model,
      sessionID
    );
  }

  let modelValues = await fetchModelsForMake(
    clientState,
    context.inventoryUrl,
    yardId,
    make,
    context.runState,
    { hasMultipleLocations: context.hasMultipleLocations }
  );
  if (modelValues.length === 0) modelValues = [''];

  let count = 0;
  for (const currentModel of modelValues) {
    count += await scrapeMakeModelHttp(
      clientState,
      context,
      yardId,
      make,
      currentModel,
      sessionID
    );
  }
  return count;
}

async function scrapeYardMakeModelHttp(
  clientState,
  context,
  yardId,
  make,
  model,
  sessionID
) {
  console.log(`Scraping yard: ${yardId}, make: ${make}, model: ${model}`);

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
      : await scrapeSelectedMake(
          clientState,
          context,
          yardId,
          make,
          model,
          sessionID
        );

  if (make !== 'ANY') {
    console.log(`[scrape] Yard ${yardId} make ${make} rows ${rowCount}`);
  }
  console.log(`HTTP rows processed for yard ${yardId}: ${rowCount}`);
  console.log(`✅ Finished scraping yard: ${yardId}, make: ${make}, model: ${model}`);
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
  const clientState = createHttpClientState(dependencies);

  try {
    logScrapeRequest(options);

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
