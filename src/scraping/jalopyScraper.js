const { Builder, By, Key, until } = require('selenium-webdriver');
const { Browser } = require('selenium-webdriver');

async function webScrape(yardId, make, model) {
    let driver = await new Builder().forBrowser(Browser.CHROME).build();

    try {
        // log the user input
        console.log('🔍 Scraping for:');
        console.log(`   🏞️ Yard ID: ${yardId}`);
        console.log(`   🚗 Make: ${make}`);
        console.log(`   📋 Model: ${model}`);


        // Replace 'https://inventory.pickapartjalopyjungle.com/' with the actual URL you want to scrape
        await driver.get('https://inventory.pickapartjalopyjungle.com/');

        // Execute JavaScript to directly set the values of dropdowns
        await driver.executeScript(`document.getElementById('yard-id').value = '${yardId}';`);


        await driver.executeScript(`document.getElementById('car-make').value = '${make}';`);
        


        await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);


        await driver.executeScript(`document.getElementById('searchinventory').submit();`);

        // Optionally, trigger any onchange events associated with these dropdowns
        await driver.executeScript(`
            document.getElementById('yard-id').dispatchEvent(new Event('change'));
            document.getElementById('car-make').dispatchEvent(new Event('change'));
            document.getElementById('car-model').dispatchEvent(new Event('change'));
        `);

        // Wait for the table to be displayed after setting the values
        await driver.wait(until.elementLocated(By.css('.table-responsive table')), 10000);

        // Extract and log the data from the table
        let tableData = await driver.findElement(By.css('.table-responsive table')).getText();
        

        if (model !== 'Any') {
            await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
            await driver.executeScript(`document.getElementById('searchinventory').submit();`);
            await driver.wait(until.elementLocated(By.css('.table-responsive table')), 10000);
            let tableDataModel = await driver.findElement(By.css('.table-responsive table')).getText();
            console.log(tableDataModel);
        } else {
            console.log(tableData);
        }


    } catch (error) {
        console.error('Scraping failed:', error);
    } finally {
        await driver.quit();
    }
}

module.exports = { webScrape };
