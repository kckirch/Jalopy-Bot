/**
 * universalWebScrape.js
 *
 * Handles automated web scraping of vehicle inventory from various junkyard websites.
 * Uses Selenium WebDriver to interact with the websites, navigating through yard and vehicle options to gather and update vehicle details.
 * Functions included:
 * - `universalWebScrape(options)`: Main function to initiate scraping based on the provided options.
 * - `scrapeYardMakeModel(driver, yardId, make, model, sessionID, hasMultipleLocations)`: Scrapes vehicle details for a specific yard, make, and model combination.
 * - `scrapeMakeModel(driver, yardId, make, model, sessionID)`: Handles detailed scraping for specific vehicle makes and models within a yard.
 *
 * This module leverages Selenium for browser automation to fetch and submit forms dynamically, handle navigation, and extract vehicle data for subsequent database updates using `insertOrUpdateVehicle` from the vehicleDbInventoryManager module.
 */

const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const os = require('os');
const { insertOrUpdateVehicle, markInactiveVehicles } = require('../database/vehicleDbInventoryManager');

// Determine the Chromedriver path based on the operating system
const isWindows = os.platform() === 'win32';
const chromedriverPath = isWindows ? 'C:/Program Files/chromedriver-win64/chromedriver.exe' : '/usr/local/bin/chromedriver'; // Update this path to your Chromedriver

async function universalWebScrape(options) {
    const startTime = Date.now();  // Capture start time

    let chromeOptions = new chrome.Options();
    chromeOptions.addArguments('--ignore-certificate-errors');
    chromeOptions.addArguments('--disable-gpu');
    chromeOptions.addArguments('--headless');
    chromeOptions.addArguments('excludeSwitches=enable-logging');
    chromeOptions.addArguments('--ignore-certificate-errors');
    chromeOptions.addArguments('--allow-running-insecure-content');

    let serviceBuilder = new chrome.ServiceBuilder(chromedriverPath);

    let driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(chromeOptions)
        .setChromeService(serviceBuilder)
        .build();

    try {
        console.log('🔍 Scraping for:');
        console.log(`   🏞️ Yard ID: ${options.yardId}`);
        console.log(`   🚗 Make: ${options.make}`);
        console.log(`   📋 Model: ${options.model}`);

        await driver.get(options.inventoryUrl);

        // Handle if the yard has multiple locations
        if (options.hasMultipleLocations) {
            await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
            let yardOptions = await driver.findElements(By.css('#yard-id option'));
            for (let i = 1; i < yardOptions.length; i++) {  // Start from 1 to skip default/placeholder option
                await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
                yardOptions = await driver.findElements(By.css('#yard-id option'));
                let currentYardId = await yardOptions[i].getAttribute('value');
                if (currentYardId) {
                    await driver.executeScript(`document.getElementById('yard-id').value = '${currentYardId}';`);
                    await driver.executeScript(`document.getElementById('searchinventory').submit();`);
                    await scrapeYardMakeModel(driver, currentYardId, options.make, options.model, options.sessionID, options.hasMultipleLocations);
                }
            }
        } else {
            // For single location yard, proceed without changing yard selection
            await scrapeYardMakeModel(driver, options.yardId, options.make, options.model, options.sessionID, options.hasMultipleLocations);
        }
    } catch (error) {
        if (error.message.includes('spawn') && error.message.includes('ENOENT')) {
            console.error('Error: Chromedriver not found. Please ensure the path to chromedriver is correct.');
        } else if (error.message.includes('session not created')) {
            console.error('Error: Chromedriver version mismatch. Please ensure you have the correct version of Chromedriver for your installed Chrome browser.');
        } else {
            console.error('Scraping failed:', error);
        }
    } finally {
        markInactiveVehicles(options.sessionID);
        console.log('🛑 Closing browser');
        await driver.quit();

        const endTime = Date.now();  // Capture end time
        const duration = endTime - startTime;
        const minutes = Math.floor(duration / 60000);  // Convert duration to minutes
        const seconds = ((duration % 60000) / 1000).toFixed(0);  // Convert remainder to seconds
        console.log(`Scraping Duration: ${minutes} minutes and ${seconds} seconds.`);
    }
}

async function scrapeYardMakeModel(driver, yardId, make, model, sessionID, hasMultipleLocations) {
    console.log(`Scraping yard: ${yardId}, make: ${make}, model: ${model}`);

    if (hasMultipleLocations) {
        await driver.executeScript(`document.getElementById('yard-id').value = '${yardId}';`);
    }

    await driver.executeScript(`document.getElementById('car-make').value = '${make}';`);
    await driver.executeScript(`document.getElementById('searchinventory').submit();`);

    if (make === 'ANY') {
        await driver.wait(until.elementLocated(By.css('#car-make')), 5000);
        let makeOptions = await driver.findElements(By.css('#car-make option'));
        for (let i = 1; i < makeOptions.length; i++) {  // Start from 1 to skip default/placeholder option
            await driver.wait(until.elementLocated(By.css('#car-make')), 5000);
            makeOptions = await driver.findElements(By.css('#car-make option'));
            let currentMake = await makeOptions[i].getAttribute('value');
            if (currentMake) {
                await driver.executeScript(`document.getElementById('car-make').value = '${currentMake}';`);
                await driver.executeScript(`document.getElementById('searchinventory').submit();`);
                await scrapeMakeModel(driver, yardId, currentMake, model, sessionID);
            }
        }
    } else {
        await scrapeMakeModel(driver, yardId, make, model, sessionID);
    }

    console.log(`✅ Finished scraping yard: ${yardId}, make: ${make}, model: ${model}`);
}

async function scrapeMakeModel(driver, yardId, make, model, sessionID) {
    await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
    await driver.executeScript(`document.getElementById('car-make').dispatchEvent(new Event('change'));`);
    await driver.sleep(1000);
    await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
    await driver.executeScript(`document.getElementById('searchinventory').submit();`);

    await driver.wait(until.elementLocated(By.css('.table-responsive table')), 10000);

    let rows = await driver.findElements(By.css('.table-responsive table tbody tr'));
    for (let row of rows) {
        let cols = await row.findElements(By.tagName('td'));
        if (cols.length >= 4) {
            insertOrUpdateVehicle(
                yardId,
                await cols[1].getText(), // make
                await cols[2].getText(), // model
                parseInt(await cols[0].getText(), 10), // year
                parseInt(await cols[3].getText(), 10), // row number
                '', // status
                '', // notes
                sessionID // session ID
            );
        }
    }
}

module.exports = { universalWebScrape };
