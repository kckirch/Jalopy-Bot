const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { insertOrUpdateVehicle, markInactiveVehicles } = require('../database/vehicleDbInventoryManager');
const { resolveChromedriverPath } = require('./chromedriverResolver');

function normalizeYardId(yardId) {
  const parsed = parseInt(yardId, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle) {
  await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
  await driver.executeScript(`document.getElementById('car-make').dispatchEvent(new Event('change'));`);
  await driver.sleep(1000);
  await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
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
        '',
        sessionID
      );
      processedRows += 1;
    }
  }

  return processedRows;
}

async function scrapeYardMakeModel(driver, yardId, make, model, sessionID, hasMultipleLocations, upsertVehicle) {
  console.log(`Scraping yard: ${yardId}, make: ${make}, model: ${model}`);

  if (hasMultipleLocations) {
    await driver.executeScript(`document.getElementById('yard-id').value = '${yardId}';`);
  }

  await driver.executeScript(`document.getElementById('car-make').value = '${make}';`);
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
        await driver.executeScript(`document.getElementById('car-make').value = '${currentMake}';`);
        await driver.executeScript(`document.getElementById('searchinventory').submit();`);
        const makeRows = await scrapeMakeModel(driver, yardId, currentMake, model, sessionID, upsertVehicle);
        totalRows += makeRows;
        console.log(`[scrape] Yard ${yardId} make ${currentMake} rows ${makeRows}`);
      }
    }
    if (processedMakeCount === 0) {
      // Fallback for pages that do not expose populated make options reliably.
      const makeRows = await scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle);
      totalRows += makeRows;
      console.log(`[scrape] Yard ${yardId} make ${make} rows ${makeRows}`);
    }
    console.log(`[scrape] Yard ${yardId} total rows ${totalRows}`);
  } else {
    const rows = await scrapeMakeModel(driver, yardId, make, model, sessionID, upsertVehicle);
    console.log(`[scrape] Yard ${yardId} make ${make} rows ${rows}`);
  }

  console.log(`✅ Finished scraping yard: ${yardId}, make: ${make}, model: ${model}`);
}

async function scrapeWithSelenium(options, deps = {}) {
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

  const chromeOptions = new chrome.Options();
  chromeOptions.addArguments('--ignore-certificate-errors');
  chromeOptions.addArguments('--disable-gpu');
  chromeOptions.addArguments('--headless');
  chromeOptions.addArguments('excludeSwitches=enable-logging');
  chromeOptions.addArguments('--ignore-certificate-errors');
  chromeOptions.addArguments('--allow-running-insecure-content');

  let builder = new Builder().forBrowser('chrome').setChromeOptions(chromeOptions);
  const chromedriverPath = resolveChromedriverPath();

  if (chromedriverPath) {
    console.log(`Using chromedriver at: ${chromedriverPath}`);
    const serviceBuilder = new chrome.ServiceBuilder(chromedriverPath);
    builder = builder.setChromeService(serviceBuilder);
  } else {
    console.warn('Chromedriver not found in known locations. Attempting to use Selenium default driver resolution.');
  }

  const driver = await builder.build();

  try {
    console.log('🔍 Scraping for:');
    console.log(`   🏞️ Yard ID: ${options.yardId || 'ALL'}`);
    console.log(`   🚗 Make: ${options.make}`);
    console.log(`   📋 Model: ${options.model}`);

    await driver.get(options.inventoryUrl);

    if (options.hasMultipleLocations) {
      await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);

      if (options.yardId) {
        const normalizedYardId = normalizeYardId(options.yardId);
        if (normalizedYardId !== null) {
          scrapedYardIds.add(normalizedYardId);
        }
        await driver.executeScript(`document.getElementById('yard-id').value = '${options.yardId}';`);
        await driver.executeScript(`document.getElementById('searchinventory').submit();`);
        await scrapeYardMakeModel(
          driver,
          options.yardId,
          options.make,
          options.model,
          options.sessionID,
          options.hasMultipleLocations,
          trackingUpsertVehicle
        );
      } else {
        let yardOptions = await driver.findElements(By.css('#yard-id option'));
        for (let i = 1; i < yardOptions.length; i += 1) {
          await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
          yardOptions = await driver.findElements(By.css('#yard-id option'));
          const currentYardId = await yardOptions[i].getAttribute('value');
          if (currentYardId) {
            const normalizedYardId = normalizeYardId(currentYardId);
            if (normalizedYardId !== null) {
              scrapedYardIds.add(normalizedYardId);
            }
            await driver.executeScript(`document.getElementById('yard-id').value = '${currentYardId}';`);
            await driver.executeScript(`document.getElementById('searchinventory').submit();`);
            await scrapeYardMakeModel(
              driver,
              currentYardId,
              options.make,
              options.model,
              options.sessionID,
              options.hasMultipleLocations,
              trackingUpsertVehicle
            );
          }
        }
      }
    } else {
      const normalizedYardId = normalizeYardId(options.yardId);
      if (normalizedYardId !== null) {
        scrapedYardIds.add(normalizedYardId);
      }
      await scrapeYardMakeModel(
        driver,
        options.yardId,
        options.make,
        options.model,
        options.sessionID,
        options.hasMultipleLocations,
        trackingUpsertVehicle
      );
    }
    scrapeSucceeded = true;
  } catch (error) {
    if (error.message.includes('spawn') && error.message.includes('ENOENT')) {
      console.error('Error: Chromedriver not found. Please ensure the path to chromedriver is correct.');
    } else if (error.message.includes('session not created')) {
      console.error('Error: Chromedriver version mismatch. Please ensure you have the correct version of Chromedriver for your installed Chrome browser.');
    } else {
      console.error('Scraping failed:', error);
    }
    throw error;
  } finally {
    try {
      if (options.shouldMarkInactive === true && scrapeSucceeded && scrapedYardIds.size > 0 && upsertCount > 0) {
        await reconcileInactiveVehicles(options.sessionID, { yardIds: [...scrapedYardIds] });
      } else {
        console.log(`Skipping inactive reconciliation. shouldMarkInactive=${options.shouldMarkInactive === true}, scrapeSucceeded=${scrapeSucceeded}, scopedYards=${scrapedYardIds.size}, upserts=${upsertCount}`);
      }
    } catch (markInactiveError) {
      console.error('Error during inactive reconciliation:', markInactiveError);
    }

    console.log('🛑 Closing browser');
    await driver.quit();

    const endTime = Date.now();
    const duration = endTime - startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(0);
    console.log(`Scraping Duration: ${minutes} minutes and ${seconds} seconds.`);
  }
}

module.exports = {
  scrapeWithSelenium,
  __testables: {
    normalizeYardId,
  },
};
