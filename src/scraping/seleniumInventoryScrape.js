const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { insertOrUpdateVehicle, markInactiveVehicles } = require('../database/vehicleDbInventoryManager');
const { resolveChromedriverPath } = require('./chromedriverResolver');
const { summarizeError } = require('../utils/errorSummary');
const {
  createScrapeRun,
  logScrapeDuration,
  logScrapeRequest,
  reconcileScrapeRun,
} = require('./scrapeLifecycle');
const { logScrapeYardResult } = require('./scrapeLogging');

function setElementValue(driver, elementId, value) {
  return driver.executeScript(
    'document.getElementById(arguments[0]).value = arguments[1];',
    elementId,
    value
  );
}

async function scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle) {
  await setElementValue(driver, 'car-model', model);
  await driver.executeScript(`document.getElementById('car-make').dispatchEvent(new Event('change'));`);
  await driver.sleep(1000);
  await setElementValue(driver, 'car-model', model);
  await driver.executeScript(`document.getElementById('searchinventory').submit();`);

  await driver.wait(until.elementLocated(By.css('.table-responsive table')), 10000);
  const rows = await driver.findElements(By.css('.table-responsive table tbody tr'));
  let processedRows = 0;

  for (const row of rows) {
    const cols = await row.findElements(By.tagName('td'));
    if (cols.length >= 4) {
      await upsertVehicle(
        yardId,
        await cols[1].getText(),
        await cols[2].getText(),
        parseInt(await cols[0].getText(), 10),
        parseInt(await cols[3].getText(), 10),
        '',
        sessionID
      );
      processedRows += 1;
    }
  }

  return processedRows;
}

async function scrapeYardMakeModel(driver, yardId, make, model, sessionID, hasMultipleLocations, upsertVehicle) {
  if (hasMultipleLocations) {
    await setElementValue(driver, 'yard-id', yardId);
  }

  await setElementValue(driver, 'car-make', make);
  await driver.executeScript(`document.getElementById('searchinventory').submit();`);

  if (make === 'ANY') {
    await driver.wait(until.elementLocated(By.css('#car-make')), 5000);
    let makeOptions = await driver.findElements(By.css('#car-make option'));
    let processedMakeCount = 0;
    let totalRows = 0;
    for (let i = 1; i < makeOptions.length; i += 1) {
      await driver.wait(until.elementLocated(By.css('#car-make')), 5000);
      makeOptions = await driver.findElements(By.css('#car-make option'));
      const currentMake = await makeOptions[i].getAttribute('value');
      if (currentMake) {
        processedMakeCount += 1;
        await setElementValue(driver, 'car-make', currentMake);
        await driver.executeScript(`document.getElementById('searchinventory').submit();`);
        const makeRows = await scrapeMakeModel(driver, yardId, currentMake, model, sessionID, upsertVehicle);
        totalRows += makeRows;
      }
    }
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

async function scrapeWithSelenium(options, deps = {}) {
  const upsertVehicle = deps.insertOrUpdateVehicle || insertOrUpdateVehicle;
  const reconcileInactiveVehicles = deps.markInactiveVehicles || markInactiveVehicles;
  const run = createScrapeRun(upsertVehicle);

  const chromeOptions = new chrome.Options();
  chromeOptions.addArguments('--ignore-certificate-errors');
  chromeOptions.addArguments('--disable-gpu');
  chromeOptions.addArguments('--headless');
  chromeOptions.addArguments('excludeSwitches=enable-logging');
  chromeOptions.addArguments('--allow-running-insecure-content');

  let builder = new Builder().forBrowser('chrome').setChromeOptions(chromeOptions);
  const chromedriverPath = resolveChromedriverPath();

  if (chromedriverPath) {
    console.log('Using configured Chromedriver.');
    const serviceBuilder = new chrome.ServiceBuilder(chromedriverPath);
    builder = builder.setChromeService(serviceBuilder);
  } else {
    console.warn('Chromedriver not found in known locations. Attempting to use Selenium default driver resolution.');
  }

  const driver = await builder.build();

  try {
    logScrapeRequest(options);

    await driver.get(options.inventoryUrl);

    if (options.hasMultipleLocations) {
      await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);

      if (options.yardId) {
        run.trackYard(options.yardId);
        await setElementValue(driver, 'yard-id', options.yardId);
        await driver.executeScript(`document.getElementById('searchinventory').submit();`);
        await scrapeYardMakeModel(
          driver,
          options.yardId,
          options.make,
          options.model,
          options.sessionID,
          options.hasMultipleLocations,
          run.upsertVehicle
        );
      } else {
        let yardOptions = await driver.findElements(By.css('#yard-id option'));
        for (let i = 1; i < yardOptions.length; i += 1) {
          await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
          yardOptions = await driver.findElements(By.css('#yard-id option'));
          const currentYardId = await yardOptions[i].getAttribute('value');
          if (currentYardId) {
            run.trackYard(currentYardId);
            await setElementValue(driver, 'yard-id', currentYardId);
            await driver.executeScript(`document.getElementById('searchinventory').submit();`);
            await scrapeYardMakeModel(
              driver,
              currentYardId,
              options.make,
              options.model,
              options.sessionID,
              options.hasMultipleLocations,
              run.upsertVehicle
            );
          }
        }
      }
    } else {
      run.trackYard(options.yardId);
      await scrapeYardMakeModel(
        driver,
        options.yardId,
        options.make,
        options.model,
        options.sessionID,
        options.hasMultipleLocations,
        run.upsertVehicle
      );
    }
    run.markSucceeded();
  } catch (error) {
    const errorMessage = typeof error?.message === 'string' ? error.message : '';
    if (errorMessage.includes('spawn') && errorMessage.includes('ENOENT')) {
      console.error('Error: Chromedriver not found. Please ensure the path to chromedriver is correct.');
    } else if (errorMessage.includes('session not created')) {
      console.error('Error: Chromedriver version mismatch. Please ensure you have the correct version of Chromedriver for your installed Chrome browser.');
    } else {
      console.error('Scraping failed:', summarizeError(error));
    }
    throw error;
  } finally {
    await reconcileScrapeRun(run, options, reconcileInactiveVehicles);

    console.log('🛑 Closing browser');
    await driver.quit();
    logScrapeDuration(run.startedAt);
  }
}

module.exports = { scrapeWithSelenium };
