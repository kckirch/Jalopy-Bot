require('dotenv').config({ path: '../.env' });  // Ensure environment variables are loaded

const { setupDatabase } = require('../database/database');  // Ensure the database is set up
const { universalWebScrape } = require('../scraping/universalWebScrape');

// Define the session ID for tracking the current scraping session
const sessionID = Date.now().toString(); // You can customize how session IDs are generated

// Define test cases for different junkyards
const testCases = {
    jalopyJungle: {
        inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
        yardId: 'ALL', // Because Jalopy Jungle has multiple locations
        make: 'ANY',
        model: 'ANY',
        sessionID: sessionID,
        hasMultipleLocations: true,
        locationMapping: {
            1020: 'BOISE',
            1021: 'CALDWELL',
            1022: 'NAMPA',
            1119: 'GARDENCITY',
            1099: 'TWINFALLS'

        }
    },
    trustyJunkyard: {
        inventoryUrl: 'https://inventory.trustypickapart.com/',
        yardId: '999999', // Trusty is a single location yard
        make: 'ANY',
        model: 'ANY',
        sessionID: sessionID,
        hasMultipleLocations: false, // No multiple locations for Trusty
        locationMapping: null // No need for location mapping for single yard
    }
};

// Function to run the tests
async function runTestScraper(junkyard) {
    try {
        console.log(`Starting test for: ${junkyard}`);
        await universalWebScrape(testCases[junkyard]);
        console.log(`Test for ${junkyard} completed successfully.`);
    } catch (error) {
        console.error(`Error running test for ${junkyard}:`, error);
    }
}

// Set up the database before running the tests
async function startTest() {
    // Set up the database before running the scraper
    await setupDatabase().then(() => {
        console.log('Database connection established.');
    }).catch((err) => {
        console.error('Error connecting to database:', err);
        return;  // If the database setup fails, abort the test
    });

    // Choose which junkyard to test
    // You can pass either 'jalopyJungle' or 'trustyJunkyard' or add more junkyards as needed
    runTestScraper('jalopyJungle');  // You can switch this to 'jalopyJungle' to test the other
}

// Run the test
startTest();
