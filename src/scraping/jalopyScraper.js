//jalopyScraper.js

const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver');
const { Browser } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');



const { insertOrUpdateVehicle } = require('../database/inventoryDb');


async function webScrape(yardId, make, model) {
    let options = new chrome.Options();
    options.addArguments('--ignore-certificate-errors');
    options.addArguments('--disable-gpu');
    options.addArguments('--headless');
    options.addArguments('excludeSwitches=enable-logging');
    options.addArguments('--ignore-certificate-errors');
    options.addArguments('--allow-running-insecure-content');
    

    let driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(options)
        .build();

    try {
       
        console.log('🔍 Scraping for:');
        console.log(`   🏞️ Yard ID: ${yardId}`);
        console.log(`   🚗 Make: ${make}`);
        console.log(`   📋 Model: ${model}`);

        await driver.get('https://inventory.pickapartjalopyjungle.com/');

    

        //Handle if searching for all yards
        if (yardId === 'ALL') {
            // Refetch yard options for each iteration to avoid stale references
            await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
            let yardOptions = await driver.findElements(By.css('#yard-id option'));
            for (let i = 1; i < yardOptions.length; i++) {  // Start from 1 to skip default/placeholder option
                // Re-fetch the dropdown and select the yard to handle potential updates
                await driver.wait(until.elementLocated(By.css('#yard-id')), 5000);
                yardOptions = await driver.findElements(By.css('#yard-id option'));
                let currentYardId = await yardOptions[i].getAttribute('value');
                if (currentYardId) {
                    await driver.executeScript(`document.getElementById('yard-id').value = '${currentYardId}';`);
                    await driver.executeScript(`document.getElementById('searchinventory').submit();`);
                    await scrapeYardMakeModel(driver, currentYardId, make, model);
                }
            }
        } else {
            await scrapeYardMakeModel(driver, yardId, make, model);
        }



    } catch (error) {
        console.error('Scraping failed:', error);
    } finally {
        console.log('🛑 Closing browser');
        await driver.quit();
    }
}


async function scrapeYardMakeModel(driver, yardId, make, model) {
    console.log(`Scraping yard: ${yardId}, make: ${make}, model: ${model}`);
    await driver.executeScript(`document.getElementById('yard-id').value = '${yardId}';`);
    await driver.executeScript(`document.getElementById('car-make').value = '${make}';`);
    await driver.executeScript(`document.getElementById('searchinventory').submit();`);

    if (make === 'ANY') {
        // Refetch makes for each iteration to avoid stale references
        await driver.wait(until.elementLocated(By.css('#car-make')), 5000);
        let makeOptions = await driver.findElements(By.css('#car-make option'));
        for (let i = 1; i < makeOptions.length; i++) {  // Start from 1 to skip default/placeholder option
            // Re-fetch the dropdown and select the make to handle potential updates
            await driver.wait(until.elementLocated(By.css('#car-make')), 5000);
            makeOptions = await driver.findElements(By.css('#car-make option'));
            let currentMake = await makeOptions[i].getAttribute('value');
            if (currentMake) {
                await driver.executeScript(`document.getElementById('car-make').value = '${currentMake}';`);
                await driver.executeScript(`document.getElementById('searchinventory').submit();`);
                await scrapeMakeModel(driver, yardId, currentMake, model);
            }
        }
    } else {
        await scrapeMakeModel(driver, yardId, make, model);
    }

    console.log(`✅ Finished scraping yard: ${yardId}, make: ${make}, model: ${model}`);
}


async function scrapeMakeModel(driver, yardId, make, model) {
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
                '' // notes
            );
            
        }
    }
}


    

module.exports = { webScrape };