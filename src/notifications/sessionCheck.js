// sessionCheck.js
const { db } = require('../database/database');

async function checkSessionUpdates() {
    const sql = 'SELECT MAX(last_updated) as lastUpdate FROM vehicles';
    return new Promise((resolve, reject) => {
        db.get(sql, (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            // Get the last update time from the database result
            const lastUpdateTimeUTC = new Date(result.lastUpdate);
            
            // Convert database time from UTC to your desired time zone (e.g., MST)
            const lastUpdateTime = new Date(lastUpdateTimeUTC.toLocaleString("en-US", {timeZone: "America/Denver"}));

            // Get the current time in the desired time zone
            const currentTime = new Date().toLocaleString("en-US", {timeZone: "America/Denver"});

            // Convert the current time string to a Date object
            const currentTimeObj = new Date(currentTime);

            // Calculate the time difference in milliseconds
            const timeDifference = currentTimeObj - lastUpdateTime;

            // Check if the time difference is less than 30 minutes (1800000 milliseconds)
            resolve(timeDifference < 1800000);
        });
    });
}

module.exports = { checkSessionUpdates };

