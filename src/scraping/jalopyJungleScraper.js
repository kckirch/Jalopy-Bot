/**
 * jalopyJungleScraper.js
 * 
 * Handles automated web scraping of vehicle inventory from the Pick-a-Part Jalopy Jungle website.
 * Uses Selenium WebDriver to interact with the website, navigating through yard and vehicle options to gather and update vehicle details.
 * Functions included:
 * - `webScrape(yardId, make, model)`: Main function to initiate scraping based on yard, make, and model criteria.
 * - `scrapeYardMakeModel(driver, yardId, make, model)`: Scrapes vehicle details for a specific yard, make, and model combination.
 * - `scrapeMakeModel(driver, yardId, make, model)`: Handles detailed scraping for specific vehicle makes and models within a yard.
 * 
 * This module leverages Selenium for browser automation to fetch and submit forms dynamically, handle navigation, and extract vehicle data for subsequent database updates using `insertOrUpdateVehicle` from the vehicleDbInventoryManager module.
 */

const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const os = require('os');
const { insertOrUpdateVehicle, markInactiveVehicles } = require('../database/vehicleDbInventoryManager');

// Determine the Chromedriver path based on the operating system
const isWindows = os.platform() === 'win32';
const chromedriverPath = isWindows ? 'path/to/windows/chromedriver' : '/usr/local/bin/chromedriver';

async function webScrape(yardId, make, model, sessionID) {
    const startTime = Date.now();  // Capture start time

    let options = new chrome.Options();
    options.addArguments('--ignore-certificate-errors');
    options.addArguments('--disable-gpu');
    options.addArguments('--headless');
    options.addArguments('excludeSwitches=enable-logging');
    options.addArguments('--ignore-certificate-errors');
    options.addArguments('--allow-running-insecure-content');

    let serviceBuilder = new chrome.ServiceBuilder(chromedriverPath);  // Path to system-installed Chromedriver

    let driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .setChromeService(serviceBuilder)
        .build();

    try {
        console.log('🔍 Scraping for:');
        console.log(`   🏞️ Yard ID: ${yardId}`);
        console.log(`   🚗 Make: ${make}`);
        console.log(`   📋 Model: ${model}`);

        await driver.get('https://inventory.pickapartjalopyjungle.com/');

        // Handle if searching for all yards
        if (yardId === 'ALL') {
            await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
            let yardOptions = await driver.findElements(By.css('#yard-id option'));
            for (let i = 1; i < yardOptions.length; i++) {  // Start from 1 to skip default/placeholder option
                await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
                yardOptions = await driver.findElements(By.css('#yard-id option'));
                let currentYardId = await yardOptions[i].getAttribute('value');
                if (currentYardId) {
                    await driver.executeScript(`document.getElementById('yard-id').value = '${currentYardId}';`);
                    await driver.executeScript(`document.getElementById('searchinventory').submit();`);
                    await scrapeYardMakeModel(driver, currentYardId, make, model, sessionID);
                }
            }
        } else {
            await scrapeYardMakeModel(driver, yardId, make, model, sessionID);
        }
    } catch (error) {
        console.error('Scraping failed:', error);
    } finally {
        markInactiveVehicles(sessionID);
        console.log('🛑 Closing browser');
        await driver.quit();

        const endTime = Date.now();  // Capture end time
        const duration = endTime - startTime;
        const minutes = Math.floor(duration / 60000);  // Convert duration to minutes
        const seconds = ((duration % 60000) / 1000).toFixed(0);  // Convert remainder to seconds
        console.log(`Scraping Duration: ${minutes} minutes and ${seconds} seconds.`);
    }
}

async function scrapeYardMakeModel(driver, yardId, make, model, sessionID) {
    console.log(`Scraping yard: ${yardId}, make: ${make}, model: ${model}`);
    await driver.executeScript(`document.getElementById('yard-id').value = '${yardId}';`);
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

module.exports = { webScrape };
