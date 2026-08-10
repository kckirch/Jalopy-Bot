const { db } = require('./database');
const { summarizeError } = require('../utils/errorSummary');

const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors']);

function validateJobKey(jobName, sessionID) {
  if (!/^[a-z0-9-]+$/.test(jobName) || !/^\d{8}$/.test(sessionID)) {
    throw new TypeError('Scheduled job name or session ID is invalid.');
  }
}

function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        console.error('Scheduled job database write failed:', summarizeError(error));
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(jobName, sessionID) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT job_name, session_id, status, started_at, completed_at, summary
       FROM scheduled_job_runs
       WHERE job_name = ? AND session_id = ?;`,
      [jobName, sessionID],
      (error, row) => {
        if (error) {
          console.error('Scheduled job database read failed:', summarizeError(error));
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

async function getScheduledJobRun(jobName, sessionID) {
  validateJobKey(jobName, sessionID);
  const row = await get(jobName, sessionID);
  return row ? { ...row, summary: parseSummary(row.summary) } : null;
}

async function claimScheduledJobRun(jobName, sessionID) {
  validateJobKey(jobName, sessionID);
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
    [jobName, sessionID]
  );
  return result.changes === 1;
}

async function finishScheduledJobRun(jobName, sessionID, status, summary) {
  validateJobKey(jobName, sessionID);
  if (!TERMINAL_STATUSES.has(status)) {
    throw new TypeError('Scheduled job terminal status is invalid.');
  }
  const result = await run(
    `UPDATE scheduled_job_runs
     SET status = ?, completed_at = CURRENT_TIMESTAMP, summary = ?
     WHERE job_name = ? AND session_id = ? AND status = 'running';`,
    [status, JSON.stringify(summary || {}), jobName, sessionID]
  );
  if (result.changes !== 1) {
    throw new Error('Scheduled job could not be completed from its current state.');
  }
}

async function failScheduledJobRun(jobName, sessionID) {
  validateJobKey(jobName, sessionID);
  await run(
    `UPDATE scheduled_job_runs
     SET status = 'failed', completed_at = CURRENT_TIMESTAMP, summary = NULL
     WHERE job_name = ? AND session_id = ? AND status = 'running';`,
    [jobName, sessionID]
  );
}

module.exports = {
  claimScheduledJobRun,
  failScheduledJobRun,
  finishScheduledJobRun,
  getScheduledJobRun,
  isTerminalScheduledJobStatus: (status) => TERMINAL_STATUSES.has(status),
};
