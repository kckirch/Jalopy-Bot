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
    '1500' : ['1500', 'C1500', 'K1500'],
    '2500' : ['2500', 'C2500', 'K2500'],
    '3500' : ['3500', 'C3500', 'K3500'],
    '3 SERIES' : ['3 series', '3-series', '3series','318', '320', '323', '325', '328', '330', '335'],
    '5 SERIES' : ['5 series', '5-series', '5series','525', '528', '530', '535', '540', '545', '550'],
    '7 SERIES' : ['7 series', '7-series', '7series','740', '745', '750', '760'],
    'X' : ['x3', 'X3', 'x5', 'X5', 'x6', 'X6'],
    'E CLASS' : ['e class', 'e-class', 'eclass', 'e320', 'e350', 'e500', 'e550', 'e63'],
    'C CLASS' : ['c class', 'c-class', 'cclass', 'c230', 'c240', 'c250', 'c280', 'c300', 'c320', 'c350', 'c63'],
    'S CLASS' : ['s class', 's-class', 'sclass', 's430', 's500', 's550', 's600', 's63'],
    'F150' : ['f150', 'f-150', 'f 150'],
    'F250' : ['f250', 'f-250', 'f 250'],
    'F350' : ['f350', 'f-350', 'f 350'],

    
};

// Function to get all possible model variations with fuzzy matching
function getModelVariations(model) {
    const aliases = modelAliases[model.toUpperCase()] || [model];
    return aliases.map(alias => '%' + alias.replace(/\s+/g, '%') + '%'); // Adding '%' for fuzzy matching and accounting for spaces
}

// Function to get all possible make variations with fuzzy matching
function getMakeVariations(make) {
    const aliases = makeAliases[make.toLowerCase()] || [make];
    return aliases.map(alias => '%' + alias.replace(/\s+/g, '%') + '%'); // Adding '%' for fuzzy matching and accounting for spaces
}

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
        const makes = getMakeVariations(make);
        const makeConditions = makes.map(() => "vehicle_make LIKE ?").join(" OR ");
        conditions.push(`(${makeConditions})`);
        params.push(...makes);
    }

    if (model !== 'ANY') {
        const models = getModelVariations(model);
        const modelConditions = models.map(() => "vehicle_model LIKE ?").join(" OR ");
        conditions.push(`(${modelConditions})`);
        params.push(...models);
    } else {
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
