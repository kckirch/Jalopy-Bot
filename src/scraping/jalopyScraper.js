//jalopyScraper.js
const { Builder, By, until } = require('selenium-webdriver');
const sqlite3 = require('sqlite3').verbose();

async function webScrape(yard_id, car_make, car_model) {
    console.log(`Web scraping started with Yard ID: ${yard_id}, Car Make: ${car_make}, Car Model: ${car_model}`);
    // let driver = new Builder().forBrowser('chrome').build();

    // try {
    //     await driver.get("http://inventory.pickapartjalopyjungle.com/");
        
    //     // Select yard, make, and model from dropdowns
    //     await selectDropdown(driver, 'yard-id', yard_id);
    //     await selectDropdown(driver, 'car-make', car_make);
    //     await selectDropdown(driver, 'car-model', car_model);
        
    //     // Click the search button
    //     await driver.findElement(By.css("input[type='submit']")).click();

    //     // Wait for the results to load
    //     await driver.wait(until.elementLocated(By.css('your-result-element-selector')), 10000);

    //     // Scrape the data
    //     const data = await scrapeData(driver);

    //     // Process and save data to SQLite
    //     saveToDatabase(data);
    // } catch (error) {
    //     console.error('Error occurred:', error);
    // } finally {
    //     await driver.quit();
    // }
}

async function selectDropdown(driver, elementId, value) {
    let dropdown = await driver.findElement(By.id(elementId));
    // Logic to select the dropdown value
    // ...
}

async function scrapeData(driver) {
    // Logic to scrape data from the page
    // Return the processed data
    // ...
}

function saveToDatabase(data) {
    // SQLite database interaction logic
    // ...
}

webScrape('yard_id', 'car_make', 'car_model', 'yard_name');


module.exports = { webScrape };
