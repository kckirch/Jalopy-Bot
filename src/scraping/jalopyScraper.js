const { Builder, By, Key, until, Capabilities } = require('selenium-webdriver');
const { Browser } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');


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
        // log the user input
        console.log('🔍 Scraping for:');
        console.log(`   🏞️ Yard ID: ${yardId}`);
        console.log(`   🚗 Make: ${make}`);
        console.log(`   📋 Model: ${model}`);


        // Replace 'https://inventory.pickapartjalopyjungle.com/' with the actual URL you want to scrape
        await driver.get('https://inventory.pickapartjalopyjungle.com/');


        // Setting the Yard ID and Make will always be needed to populate the table
        // Doing these two first will allow us to submit the form to take advantage of searching for all models easily

        // Execute JavaScript to directly set the values of dropdowns
        await driver.executeScript(`document.getElementById('yard-id').value = '${yardId}';`);
        console.log("yard-id is being searched for: " + yardId);

        await driver.executeScript(`document.getElementById('car-make').value = '${make}';`);
        console.log("car-make is being searched for: " + make);





        await driver.executeScript(`document.getElementById('searchinventory').submit();`);


        // I think its better to not wait for the table to be displayed here because we will be submitting the form again
        // these onchange events well keep in case we need later on

        // Optionally, trigger any onchange events associated with these dropdowns
        // await driver.executeScript(`
        //     document.getElementById('yard-id').dispatchEvent(new Event('change'));
        //     document.getElementById('car-make').dispatchEvent(new Event('change'));
        //     document.getElementById('car-model').dispatchEvent(new Event('change'));
        // `);

        if (model == 'ANY') {
            await driver.executeScript(`document.getElementById('car-model').value = '';`);
            //sleep for testing
            // await driver.sleep(1000);
            
            await driver.wait(until.elementLocated(By.css('.table-responsive table')), 10000);
            let tableDataModel = await driver.findElement(By.css('.table-responsive table')).getText();
            console.log("Table Data Any Model");
            console.log(tableDataModel);
        } else {


            await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
            console.log("car-model is being searched for first time.");


            await driver.executeScript(`document.getElementById('car-make').dispatchEvent(new Event('change'));`);
            //we must sleep because the event change is super slow
            // will need to investigate how to wait for the event to finish properly instead of it showing us the acura model options
            await driver.sleep(1000);
            console.log("event change is being dispatched for car-make.");

            await driver.executeScript(`document.getElementById('car-model').value = '${model}';`);
            console.log("car-model is being searched for second time.");

            await driver.executeScript(`document.getElementById('searchinventory').submit();`);
            console.log("searchinventory is being submitted.");

            // Wait for the table to be displayed after setting the values
            await driver.wait(until.elementLocated(By.css('.table-responsive table')), 10000);



            // Extract and log the data from the table
            let tableData = await driver.findElement(By.css('.table-responsive table')).getText();
                await driver.sleep(1000);
                console.log("Table Data");
                console.log(tableData);
        }


    } catch (error) {
        console.error('Scraping failed:', error);
    } finally {
        await driver.quit();
    }
}

module.exports = { webScrape };