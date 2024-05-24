/**
 * vehicleQueryManager.js
 * 
 * Manages database interactions for querying vehicle information from the `vehicleInventory.db` database.
 * Utilizes fuzzy matching to accommodate variations in vehicle makes and models, enhancing the flexibility and user-friendliness of search operations.
 * Functions included:
 * - `queryVehicles(yardId, make, model, yearInput)`: Queries the database for vehicles based on yard ID, make, model, and year. Supports 'ANY' as a wildcard.
 * - `getModelVariations(model)`: Returns possible model variations for fuzzy matching in SQL queries.
 * - `getMakeVariations(make)`: Returns possible make variations for fuzzy matching in SQL queries.
 * - `parseYearInput(yearInput)`: Parses and formats year input for SQL queries, handling ranges and specific years.
 * 
 * This module also establishes a SQLite database connection and logs connection status or errors. It defines alias mappings for vehicle makes and models to support the fuzzy matching logic.
 */

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./vehicleInventory.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error when connecting to the database', err);
    } else {
        console.log('VehicleDB Database connection established to vehicleInventory.db');
    }
});

const makeAliases = {
    'chevrolet' : ['chevrolet', 'chevy', 'chev'],
    'mercedes' : ['mercedes', 'mercedes-benz', 'mercedes benz', 'benz', 'mercedesbenz'],
    'volkswagen' : ['volkswagen', 'vw'],
    'land rover' : ['land rover', 'landrover'],
    'mini' : ['mini', 'mini cooper'],
    'bmw' : ['bmw', 'bimmer'],
};




const modelAliases = {
    '1500': ['C1500', 'K1500', 'Silverado', 'Sierra'],
    '2500': ['C2500', 'K2500', 'Silverado', 'Sierra'],
    '3500': ['C3500', 'K3500', 'Silverado', 'Sierra'],
    '3 SERIES': ['3 series', '3-series', '3series', '318', '325', '328', '330', '330CI', '335', 'M3', '340'],
    '5 SERIES': ['5 series', '5-series', '5series', '528', '530I', '540', '545I', '550', 'M5'],
    '7 SERIES': ['7 series', '7-series', '7series', '750IL'],
    'X': ['x3', 'X3', 'x5', 'X5', 'x6', 'X6'],
    'E CLASS': ['e class', 'e-class', 'eclass', 'e320', 'e350', 'e500', 'e550', 'e63'],
    'C CLASS': ['c class', 'c-class', 'cclass', 'c230', 'c240', 'c250', 'c280', 'c300', 'c320', 'c350', 'c63'],
    'S CLASS': ['s class', 's-class', 'sclass', 's430', 's500', 's550', 's600', 's63'],
    'F150': ['f-150', 'f 150'],
    'F250': ['f-250', 'f 250'],
    'F350': ['f-350', 'f 350'],
    'IS': ['IS250', 'IS300'],
    'LS': ['LS400', 'LS430'],
    'RX': ['RX300', 'RX350', 'RX400H'],
    'SC': ['SC300', 'SC430'],
    'CR-V': ['CRV', 'CR V'],
};


function parseYearInput(yearInput) {
    // If the yearInput is not provided or is an empty string, return no conditions or parameters
    if (!yearInput || yearInput.trim() === '') {
        console.log("No year input provided or input is empty.");
        return { conditions: '', params: [] };
    }

    const yearSegments = yearInput.split(',');
    let yearConditions = [];
    let yearParams = [];

    for (const segment of yearSegments) {
        if (segment.trim().includes('-')) {
            const range = segment.trim().split('-').map(Number);
            // Check if the range numbers are valid
            if (!isNaN(range[0]) && !isNaN(range[1])) {
                yearConditions.push("vehicle_year BETWEEN ? AND ?");
                yearParams.push(range[0], range[1]);
            }
        } else {
            const year = parseInt(segment.trim(), 10);
            if (!isNaN(year)) { // Ensure the year is a valid number before adding
                yearConditions.push("vehicle_year = ?");
                yearParams.push(year);
            }
        }
    }

    // If no valid conditions were added, return no conditions or parameters
    if (yearConditions.length === 0) {
        console.log("No valid year conditions found.");
        return { conditions: '', params: [] };
    }

    return { conditions: yearConditions.join(' OR '), params: yearParams };
}

function parseYardIds(input) {
    if (typeof input === 'string') {
        if (input.includes(',')) {
            // Split the string by commas and map each part to an integer
            return input.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
        } else {
            // Convert a single string ID to an integer
            const id = parseInt(input.trim(), 10);
            return isNaN(id) ? [] : [id];
        }
    } else if (Array.isArray(input)) {
        // Directly return the array assuming it's already an array of integers
        return input;
    } else if (typeof input === 'number') {
        // Wrap a single numeric ID in an array
        return [input];
    } else {
        // Handle unexpected input type
        console.error('Unexpected yardId input type:', typeof input);
        console.error('The user input was:', input);
        return []; // Return an empty array as a safe fallback
    }
}









function getMakeVariations(make) {
    if (typeof make !== 'string') {
        console.error("Expected a string for 'make', received:", make);
        return [];  // Return an empty array to handle the error gracefully
    }
    const aliases = makeAliases[make.toLowerCase()] || [make];
    return aliases.map(alias => '%' + alias.replace(/\s+/g, '%') + '%');
}

function getModelVariations(model) {
    if (typeof model !== 'string') {
        console.error("Expected a string for 'model', received:", model);
        return [];  // Return an empty array to handle the error gracefully
    }
    const aliases = modelAliases[model.toUpperCase()] || [model];
    return aliases.map(alias => '%' + alias.replace(/\s+/g, '%') + '%');
}


function queryVehicles( yardId, make, model, yearInput, status) {
    const yardIds = parseYardIds(yardId);
    let params = [];
    let conditions = [];
    let baseQuery = "SELECT * FROM vehicles";

    // Dynamically build the condition for vehicle status
    switch (status) {
        case 'ACTIVE':
            // Excludes 'Inactive' vehicles, includes both 'Active' and 'New'
            conditions.push("vehicle_status != 'INACTIVE'");
            break;
        case 'NEW':
            // Includes only 'New' vehicles
            conditions.push("vehicle_status = 'NEW'");
            break;
        case 'INACTIVE':
            // Includes only 'Inactive' vehicles
            conditions.push("vehicle_status = 'INACTIVE'");
            break;
        default:
            // Defaults to not showing 'INACTIVE' vehicles
            conditions.push("vehicle_status != 'INACTIVE'");
            break;
    }

    if (yardIds !== 'ALL' && Array.isArray(yardIds) && yardIds.length > 0) {
        conditions.push(`yard_id IN (${yardIds.map(() => '?').join(', ')})`);
        params = params.concat(yardIds);
    }

    if (make !== 'ANY') {
        const makes = getMakeVariations(make);
        conditions.push(`(${makes.map(() => "vehicle_make LIKE ?").join(" OR ")})`);
        params = params.concat(makes);
    }

    if (model !== 'ANY') {
        const models = getModelVariations(model);
        conditions.push(`(${models.map(() => "vehicle_model LIKE ?").join(" OR ")})`);
        params = params.concat(models);
    } else {
        console.log("Model set to 'Any', skipping model criteria in query.");
    }

    if (yearInput !== 'ANY') {
        const yearData = parseYearInput(yearInput);
        if (yearData.conditions) {
            conditions.push(`(${yearData.conditions})`);
            params = params.concat(yearData.params);
        }
    }

    if (conditions.length > 0) {
        baseQuery += " WHERE " + conditions.join(" AND ");
    }

    console.log("Executing query:", baseQuery);
    console.log("With parameters:", params);

    return new Promise((resolve, reject) => {
        db.all(baseQuery, params, (err, rows) => {
            if (err) {
                console.error('Failed to query vehicles:', err);
                reject(err);
            } else {
                console.log("Rows found:", rows.length);
                resolve(rows);
            }
        });
    });
}



module.exports = {
    queryVehicles, db
};
