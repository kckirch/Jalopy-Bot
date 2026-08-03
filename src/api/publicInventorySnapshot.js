const fs = require('node:fs');
const {
  buildPublicInventorySnapshot,
} = require('./publicInventorySnapshotBuilder');

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function reportRefreshError(onRefreshError, error) {
  if (typeof onRefreshError !== 'function') {
    return;
  }

  try {
    onRefreshError(error);
  } catch {
    // Refresh reporting must not turn a recoverable stale response into an unhandled rejection.
  }
}

function createPublicInventorySnapshotProvider({
  sourceDatabase,
  sourcePath,
  snapshotPath,
  buildSnapshot = buildPublicInventorySnapshot,
  onRefreshError,
}) {
  let currentSnapshot = null;
  let buildPromise = null;

  async function getDataVersion() {
    const row = await get(sourceDatabase, 'PRAGMA data_version;');
    const dataVersion = row && Number(row.data_version);
    if (!Number.isInteger(dataVersion)) {
      throw new Error('Unable to read SQLite data_version for the private runtime database.');
    }
    return dataVersion;
  }

  function startBuild(dataVersion) {
    if (buildPromise) {
      return buildPromise;
    }

    const pendingBuild = Promise.resolve()
      .then(() => buildSnapshot(sourcePath, snapshotPath))
      .then((snapshot) => {
        currentSnapshot = {
          ...snapshot,
          dataVersion,
        };
        return currentSnapshot;
      });
    buildPromise = pendingBuild;

    pendingBuild.then(
      () => {
        if (buildPromise === pendingBuild) {
          buildPromise = null;
        }
      },
      () => {
        if (buildPromise === pendingBuild) {
          buildPromise = null;
        }
      }
    );

    return pendingBuild;
  }

  function hasCurrentSnapshot() {
    return currentSnapshot && fs.existsSync(currentSnapshot.path);
  }

  async function refreshSnapshot() {
    const dataVersion = await getDataVersion();

    if (hasCurrentSnapshot() && currentSnapshot.dataVersion === dataVersion) {
      return currentSnapshot;
    }

    if (buildPromise) {
      await buildPromise;
      return refreshSnapshot();
    }

    return startBuild(dataVersion);
  }

  async function getSnapshot() {
    const dataVersion = await getDataVersion();

    if (hasCurrentSnapshot() && currentSnapshot.dataVersion === dataVersion) {
      return currentSnapshot;
    }

    if (hasCurrentSnapshot()) {
      startBuild(dataVersion).catch((error) => {
        reportRefreshError(onRefreshError, error);
      });
      return currentSnapshot;
    }

    return refreshSnapshot();
  }

  return {
    getSnapshot,
    refreshSnapshot,
  };
}

module.exports = {
  buildPublicInventorySnapshot,
  createPublicInventorySnapshotProvider,
};
