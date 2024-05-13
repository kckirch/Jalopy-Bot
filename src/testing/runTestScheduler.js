// runTestScheduler.js
const { performScrape, processSearches } = require('../notifications/testScheduler');

async function runTests() {
    await performScrape();
    await processSearches();
}

runTests()
    .then(() => console.log("All tests completed successfully."))
    .catch(error => console.error("An error occurred during the tests:", error));
