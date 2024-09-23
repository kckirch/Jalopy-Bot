// scheduler.js is a module that contains the cron jobs for the daily tasks of scraping the yard and processing saved searches. The cron library is used to schedule tasks at specific times. The tasks include running the web scraping function to gather vehicle details from the Pick-a-Part Jalopy Jungle website and processing saved searches to send notifications to users if any vehicles match their criteria. The tasks are scheduled to run at 7:00 AM and 7:10 AM UTC, respectively. The functions performScrape and processDailySavedSearches are called to execute the tasks. The checkSessionUpdates function is used to ensure that the session is updated correctly before processing the saved searches. The console.log statements are used to log the status of the tasks during execution.


const cron = require('node-cron');
const { universalWebScrape } = require('../scraping/universalWebScrape');
const { processDailySavedSearches } = require('../notifications/dailyTasks');
const { getSessionID } = require('../bot/utils/utils');
const { checkSessionUpdates } = require('../notifications/sessionCheck');
const junkyards = require('../config/junkyards'); // Import the junkyards configuration


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

async function scrapeAllJunkyards(sessionID) {
    const junkyardKeys = Object.keys(junkyards);
  
    for (const junkyardKey of junkyardKeys) {
      const junkyardConfig = junkyards[junkyardKey];
      const options = {
        ...junkyardConfig,
        make: 'ANY',
        model: 'ANY',
        sessionID: sessionID,
      };
  
      try {
        console.log(`Starting scraping for ${junkyardKey}`);
        await universalWebScrape(options);
        console.log(`Scraping completed for ${junkyardKey}`);
      } catch (error) {
        console.error(`Error scraping ${junkyardKey}:`, error);
      }
    }
  }
  

  function startScheduledTasks() {
    // Scheduled scraping of all yards every day at the designated UTC time (convert to your timezone)
    cron.schedule('0 5 * * *', () => {
      try {
        console.log('Scheduled scraping started.');
        const sessionID = getSessionID();
        console.log(`Session ID: ${sessionID}`);
        retryOperation(() => {
          console.log('Attempting to scrape all junkyards...');
          return scrapeAllJunkyards(sessionID);
        }, 3, 5000)
          .then(() => console.log('Scraping completed successfully.'))
          .catch(error => console.error('Scraping failed after retries:', error));
      } catch (error) {
        console.error('Unhandled error in scheduled task:', error);
      }
    }, {
      scheduled: true
    });
    

    // Check session and process saved searches at a slightly later time to ensure data integrity
    cron.schedule('45 5 * * *', async () => {
        console.log('Checking sessions and processing saved searches.');

        try {
            const sessionUpdated = await checkSessionUpdates();
            if (sessionUpdated) {
                await processDailySavedSearches();
                console.log('Daily saved searches processed successfully.');
            } else {
                console.log('Session not updated recently; skipping processing of saved searches.');
            }
        } catch (error) {
            console.error('Error during processing daily saved searches:', error);
        }
    }, {
        scheduled: true
    });
}

module.exports = { startScheduledTasks };



