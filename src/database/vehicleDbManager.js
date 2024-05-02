// vehicleDbManager.js

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./vehicleInventory.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error when connecting to the database', err);
    } else {
        console.log('VehicleDB Database connection established to vehicleInventory.db');
    }
});

async function queryVehicles(yardId, make, model) {
    let baseQuery = "SELECT * FROM vehicles WHERE yard_id = ?";
    let params = [yardId];

    // Append conditions only if the inputs are not 'Any'
    if (make !== 'ANY') {
        baseQuery += " AND vehicle_make = ?";
        params.push(make);
    }
    if (model !== 'ANY') {
        baseQuery += " AND vehicle_model = ?";
        params.push(model);
    } else {
        // If model is 'Any', do not try to match against 'ANY' in the database
        console.log("Model set to 'Any', skipping model criteria in query.");
    }

    console.log("Executing query:", baseQuery); // Log the final query
    console.log("With parameters:", params); // Log the parameters used in the query

    return new Promise((resolve, reject) => {
        db.all(baseQuery, params, (err, rows) => {
            if (err) {
                console.error('Failed to query vehicles:', err);
                reject(err);
            } else {
                console.log("Rows found:", rows.length); // Log the number of rows found
                resolve(rows);
            }
        });
    });
}





module.exports = {
    queryVehicles
};
