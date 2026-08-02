const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');
const { YARDS } = require('../config/yards');

const YARD_NAMES = Object.freeze(
  Object.fromEntries(YARDS.map((yard) => [yard.id, yard.databaseName]))
);

function resolveScrapeLogMode() {
  const value = String(process.env.SCRAPE_LOG_MODE || 'summary')
    .trim()
    .toLowerCase();
  return value === 'full' ? 'full' : 'summary';
}

function isFullScrapeLoggingEnabled() {
  return resolveScrapeLogMode() === 'full';
}

function logFullScrapeDetails(...args) {
  if (isFullScrapeLoggingEnabled()) {
    console.log(...args);
  }
}

function getYardNameById(yardId) {
  return YARD_NAMES[yardId] || 'Unknown Yard';
}

function normalizeYardIds(yardIds) {
  if (!Array.isArray(yardIds)) {
    return [];
  }

  return yardIds
    .map((id) => parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));
}

function markInactiveVehicles(sessionID, options = {}) {
  const scopedYardIds = normalizeYardIds(options.yardIds);

  if (scopedYardIds.length === 0) {
    console.warn('markInactiveVehicles skipped: no scoped yard IDs provided.');
    return Promise.resolve();
  }

  const placeholders = scopedYardIds.map(() => '?').join(', ');
  const sql = `
    UPDATE vehicles
    SET vehicle_status = 'INACTIVE'
    WHERE session_id != ?
      AND yard_id IN (${placeholders});
  `;

  return new Promise((resolve, reject) => {
    db.run(sql, [sessionID, ...scopedYardIds], function onMarkInactive(error) {
      if (error) {
        console.error(
          'Error marking vehicles as INACTIVE:',
          summarizeError(error)
        );
        reject(error);
        return;
      }

      console.log(
        `Marked ${this.changes} vehicles as INACTIVE for session ${sessionID} in yards [${scopedYardIds.join(', ')}].`
      );
      resolve(this.changes);
    });
  });
}

function insertOrUpdateVehicle(
  yardId,
  make,
  model,
  year,
  rowNumber,
  notes,
  sessionID
) {
  logFullScrapeDetails(
    `Processing vehicle: Yard ID = ${yardId}, Make = ${make}, Model = ${model}, Year = ${year}, Row = ${rowNumber}, Session ID = ${sessionID}`
  );
  logFullScrapeDetails(
    `Yard ID type: ${typeof yardId}, Yard ID value: ${yardId}`
  );

  const yardName = getYardNameById(yardId);
  if (yardName === 'Unknown Yard') {
    console.warn('Warning: Yard name not found for provided yard ID.');
  }

  const findSQL = `
    SELECT id, session_id, strftime('%Y%m%d', first_seen) AS first_seen_date
    FROM vehicles
    WHERE yard_id = ?
      AND vehicle_make = ?
      AND vehicle_model = ?
      AND vehicle_year = ?
      AND row_number = ?
  `;

  return new Promise((resolve, reject) => {
    db.get(
      findSQL,
      [yardId, make, model, year, rowNumber],
      function onFindVehicle(error, row) {
        if (error) {
          console.error(
            'Error searching for existing vehicle:',
            summarizeError(error)
          );
          reject(error);
          return;
        }

        if (row) {
          const finalStatus =
            row.first_seen_date === sessionID ? 'NEW' : 'ACTIVE';
          const updateSQL = `
            UPDATE vehicles
            SET vehicle_status = ?,
                last_seen = datetime('now'),
                last_updated = datetime('now'),
                session_id = ?
            WHERE id = ?;
          `;

          db.run(
            updateSQL,
            [finalStatus, sessionID, row.id],
            function onUpdateVehicle(updateError) {
              if (updateError) {
                console.error(
                  'Error updating existing vehicle:',
                  summarizeError(updateError)
                );
                reject(updateError);
                return;
              }

              logFullScrapeDetails(
                `Updated existing vehicle with ID ${row.id} to status '${finalStatus}' and session ID ${sessionID}`
              );
              resolve({ action: 'updated', id: row.id, status: finalStatus });
            }
          );
          return;
        }

        const insertSQL = `
          INSERT INTO vehicles (
            yard_id,
            yard_name,
            vehicle_make,
            vehicle_model,
            vehicle_year,
            row_number,
            first_seen,
            last_seen,
            vehicle_status,
            notes,
            date_added,
            last_updated,
            session_id
          )
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'NEW', ?, datetime('now'), datetime('now'), ?)
        `;

        db.run(
          insertSQL,
          [yardId, yardName, make, model, year, rowNumber, notes, sessionID],
          function onInsertVehicle(insertError) {
            if (insertError) {
              console.error(
                'Error inserting new vehicle:',
                summarizeError(insertError)
              );
              reject(insertError);
              return;
            }

            logFullScrapeDetails(
              `🆕 Inserted new vehicle: Yard ID = ${yardId}, Make = ${make}, Model = ${model}, Year = ${year}, Row = ${rowNumber}, Session ID = ${sessionID} 🆕`
            );
            resolve({ action: 'inserted', id: this.lastID, status: 'NEW' });
          }
        );
      }
    );
  });
}

module.exports = {
  insertOrUpdateVehicle,
  markInactiveVehicles,
};
