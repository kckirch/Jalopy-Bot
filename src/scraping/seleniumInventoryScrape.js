const { insertOrUpdateVehicle, markInactiveVehicles } = require('../database/vehicleDbInventoryManager');
const { summarizeError } = require('../utils/errorSummary');
const { createSeleniumDriver } = require('./seleniumDriverFactory');
const {
  dispatchElementChange,
  forEachSelectOptionValue,
  processInventoryRows,
  selectValueAndSubmit,
  setElementValue,
  submitInventoryForm,
} = require('./seleniumInventoryPage');
const {
  createScrapeRun,
  logScrapeDuration,
  logScrapeRequest,
  reconcileScrapeRun,
} = require('./scrapeLifecycle');
const { logScrapeYardResult } = require('./scrapeLogging');

async function scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle) {
  await setElementValue(driver, 'car-model', model);
  await dispatchElementChange(driver, 'car-make');
  await driver.sleep(1000);
  await setElementValue(driver, 'car-model', model);
  await submitInventoryForm(driver);

  return processInventoryRows(driver, (vehicle) =>
    upsertVehicle(
      yardId,
      vehicle.make,
      vehicle.model,
      vehicle.year,
      vehicle.rowNumber,
      '',
      sessionID
    )
  );
}

async function scrapeYardMakeModel(driver, yardId, make, model, sessionID, hasMultipleLocations, upsertVehicle) {
  if (hasMultipleLocations) {
    await setElementValue(driver, 'yard-id', yardId);
  }

  await setElementValue(driver, 'car-make', make);
  await submitInventoryForm(driver);

  if (make === 'ANY') {
    let processedMakeCount = 0;
    let totalRows = 0;
    await forEachSelectOptionValue(driver, 'car-make', async (currentMake) => {
      processedMakeCount += 1;
      await selectValueAndSubmit(driver, 'car-make', currentMake);
      totalRows += await scrapeMakeModel(
        driver,
        yardId,
        currentMake,
        model,
        sessionID,
        upsertVehicle
      );
    });
    if (processedMakeCount === 0) {
      // Fallback for pages that do not expose populated make options reliably.
      const makeRows = await scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle);
      totalRows += makeRows;
    }
    logScrapeYardResult(yardId, totalRows);
    return totalRows;
  } else {
    const rows = await scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle);
    logScrapeYardResult(yardId, rows);
    return rows;
  }
}

async function scrapeYard(driver, options, run, yardId, selectYard) {
  run.trackYard(yardId);
  if (selectYard) {
    await selectValueAndSubmit(driver, 'yard-id', yardId);
  }
  await scrapeYardMakeModel(
    driver,
    yardId,
    options.make,
    options.model,
    options.sessionID,
    options.hasMultipleLocations,
    run.upsertVehicle
  );
}

async function scrapeConfiguredYards(driver, options, run) {
  if (!options.hasMultipleLocations) {
    await scrapeYard(driver, options, run, options.yardId, false);
    return;
  }

  if (options.yardId) {
    await scrapeYard(driver, options, run, options.yardId, true);
    return;
  }

  await forEachSelectOptionValue(
    driver,
    'yard-id',
    (yardId) => scrapeYard(driver, options, run, yardId, true)
  );
}

function logSeleniumScrapeError(error) {
  const errorMessage = typeof error?.message === 'string' ? error.message : '';
  if (errorMessage.includes('spawn') && errorMessage.includes('ENOENT')) {
    console.error('Error: Chromedriver not found. Please ensure the path to chromedriver is correct.');
  } else if (errorMessage.includes('session not created')) {
    console.error('Error: Chromedriver version mismatch. Please ensure you have the correct version of Chromedriver for your installed Chrome browser.');
  } else {
    console.error('Scraping failed:', summarizeError(error));
  }
}

async function closeSeleniumDriver(driver, preserveExistingError) {
  if (!driver) return null;

  console.log('🛑 Closing browser');
  try {
    await driver.quit();
    return null;
  } catch (error) {
    console.error('Failed to close browser:', summarizeError(error));
    return preserveExistingError ? null : error;
  }
}

async function scrapeWithSelenium(options, deps = {}) {
  const upsertVehicle = deps.insertOrUpdateVehicle || insertOrUpdateVehicle;
  const reconcileInactiveVehicles = deps.markInactiveVehicles || markInactiveVehicles;
  const createDriver = deps.createDriver || createSeleniumDriver;
  const run = createScrapeRun(upsertVehicle);
  let driver;
  let scrapeError;
  let browserCleanupError;

  try {
    logScrapeRequest(options);
    driver = await createDriver();

    await driver.get(options.inventoryUrl);
    await scrapeConfiguredYards(driver, options, run);
    run.markSucceeded();
  } catch (error) {
    scrapeError = error;
    logSeleniumScrapeError(error);
    throw error;
  } finally {
    await reconcileScrapeRun(run, options, reconcileInactiveVehicles);
    browserCleanupError = await closeSeleniumDriver(driver, Boolean(scrapeError));
    logScrapeDuration(run.startedAt);
  }

  if (browserCleanupError) throw browserCleanupError;
}

module.exports = { scrapeWithSelenium };
