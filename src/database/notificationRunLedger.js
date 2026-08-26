const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');

const JOB_NAME = 'daily-notifications';
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors']);

function validateSessionId(sessionID) {
  if (!/^\d{8}$/.test(sessionID)) {
    throw new TypeError('Notification session ID is invalid.');
  }
}

function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        console.error('Notification ledger write failed:', summarizeError(error));
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(sessionID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT session_id, status, started_at, completed_at, summary
       FROM scheduled_job_runs
       WHERE job_name = ? AND session_id = ?;`,
      [JOB_NAME, sessionID],
      (error, row) => {
        if (error) {
          console.error('Notification ledger read failed:', summarizeError(error));
          reject(error);
          return;
        }
        resolve(row || null);
      }
    );
  });
}

function parseSummary(summary) {
  if (!summary) return null;
  try {
    return JSON.parse(summary);
  } catch {
    return null;
  }
}

async function getNotificationRun(sessionID) {
  validateSessionId(sessionID);
  const row = await get(sessionID);
  return row ? { ...row, summary: parseSummary(row.summary) } : null;
}

async function claimNotificationRun(sessionID) {
  validateSessionId(sessionID);
  const result = await run(
    `INSERT INTO scheduled_job_runs (job_name, session_id, status)
     VALUES (?, ?, 'running')
     ON CONFLICT(job_name, session_id) DO UPDATE SET
       status = 'running',
       started_at = CURRENT_TIMESTAMP,
       completed_at = NULL,
       summary = NULL
     WHERE scheduled_job_runs.status = 'failed'
        OR (
          scheduled_job_runs.status = 'running'
          AND scheduled_job_runs.started_at <= datetime('now', '-30 minutes')
        );`,
    [JOB_NAME, sessionID]
  );
  return result.changes === 1;
}

async function finishNotificationRun(sessionID, status, summary) {
  validateSessionId(sessionID);
  if (!TERMINAL_STATUSES.has(status)) {
    throw new TypeError('Notification terminal status is invalid.');
  }
  const result = await run(
    `UPDATE scheduled_job_runs
     SET status = ?, completed_at = CURRENT_TIMESTAMP, summary = ?
     WHERE job_name = ? AND session_id = ? AND status = 'running';`,
    [status, JSON.stringify(summary || {}), JOB_NAME, sessionID]
  );
  if (result.changes !== 1) {
    throw new Error('Notification run could not be completed from its current state.');
  }
}

async function failNotificationRun(sessionID) {
  validateSessionId(sessionID);
  await run(
    `UPDATE scheduled_job_runs
     SET status = 'failed', completed_at = CURRENT_TIMESTAMP, summary = NULL
     WHERE job_name = ? AND session_id = ? AND status = 'running';`,
    [JOB_NAME, sessionID]
  );
}

module.exports = {
  claimNotificationRun,
  failNotificationRun,
  finishNotificationRun,
  getNotificationRun,
  isTerminalNotificationStatus: (status) => TERMINAL_STATUSES.has(status),
};
