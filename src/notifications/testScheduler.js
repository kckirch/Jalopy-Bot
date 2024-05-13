// testScheduler.js
const { webScrape } = require('../scraping/jalopyJungleScraper');
const { processDailySavedSearches } = require('../notifications/dailyTasks');
const { getSessionID } = require('../bot/utils');

// Helper function to perform retries with a delay
function retryOperation(operation, retries, delay) {
    return new Promise((resolve, reject) => {
        operation()
            .then(resolve)
            .catch((error) => {
                if (retries > 0) {
                    console.log(`Retrying after error: ${error}. ${retries} retries left.`);
                    setTimeout(() => {
                        retryOperation(operation, retries - 1, delay).then(resolve).catch(reject);
                    }, delay);
                } else {
                    reject('Max retries reached. ' + error);
                }
            });
    });
}

async function performScrape() {
    console.log('Starting manual scraping test.');
    const sessionID = getSessionID(); // Generate a new session ID for the scrape

    try {
        await retryOperation(() => webScrape('ALL', 'ANY', 'ANY', sessionID), 3, 5000);
        console.log('Scraping completed successfully.');
    } catch (error) {
        console.error('Scraping failed after retries:', error);
    }
}

async function processSearches() {
    console.log('Starting manual processing of saved searches.');
    try {
        await processDailySavedSearches();
        console.log('Daily saved searches processed successfully.');
    } catch (error) {
        console.error('Error during processing daily saved searches:', error);
    }
}

// Expose the test functions for manual invocation
module.exports = {
    performScrape,
    processSearches
};

