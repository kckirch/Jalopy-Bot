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
    let baseQuery = "SELECT * FROM vehicles";
    let params = [];

    // Start the WHERE clause only if necessary
    let conditions = [];

    // Check if a specific yard is requested or all yards
    if (yardId !== 'ALL') {
        conditions.push("yard_id = ?");
        params.push(yardId);
    }

    // Append conditions only if the inputs are not 'Any'
    if (make !== 'ANY') {
        conditions.push("vehicle_make = ?");
        params.push(make);
    }

    if (model !== 'ANY') {
        conditions.push("vehicle_model = ?");
        params.push(model);
    } else {
        // If model is 'Any', skip model criteria in the query
        console.log("Model set to 'Any', skipping model criteria in query.");
    }

    // Append conditions to the base query if there are any
    if (conditions.length > 0) {
        baseQuery += " WHERE " + conditions.join(" AND ");
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
