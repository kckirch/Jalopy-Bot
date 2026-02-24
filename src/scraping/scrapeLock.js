let activeScrapePromise = null;
let activeScrapeLabel = null;

function createScrapeInProgressError(label) {
  const suffix = label ? ` (${label})` : '';
  const error = new Error(`A scrape is already in progress${suffix}.`);
  error.code = 'SCRAPE_IN_PROGRESS';
  error.activeScrapeLabel = label || null;
  return error;
}

async function withScrapeLock(label, operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('withScrapeLock requires an async operation function.');
  }

  if (activeScrapePromise) {
    throw createScrapeInProgressError(activeScrapeLabel);
  }

  activeScrapeLabel = String(label || 'unknown');
  const lockedPromise = Promise.resolve().then(operation);
  activeScrapePromise = lockedPromise;

  try {
    return await lockedPromise;
  } finally {
    if (activeScrapePromise === lockedPromise) {
      activeScrapePromise = null;
      activeScrapeLabel = null;
    }
  }
}

function isScrapeRunning() {
  return activeScrapePromise !== null;
}

function getActiveScrapeLabel() {
  return activeScrapeLabel;
}

function resetScrapeLockForTests() {
  activeScrapePromise = null;
  activeScrapeLabel = null;
}

module.exports = {
  withScrapeLock,
  isScrapeRunning,
  getActiveScrapeLabel,
  __testables: {
    resetScrapeLockForTests,
  },
};

