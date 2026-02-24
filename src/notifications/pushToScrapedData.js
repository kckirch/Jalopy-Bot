// pushToScrapedData.js
const simpleGit = require('simple-git');
const path = require('path');
const { VEHICLE_DB_PATH } = require('../database/dbPath');

const repoRoot = path.resolve(__dirname, '../..');
const dbFilePath = path.relative(repoRoot, VEHICLE_DB_PATH).replace(/\\/g, '/');
const git = simpleGit(repoRoot);

function normalizeGitPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

async function pushToScrapedData() {
  console.log('pushToScrapedData: function started.');
  let startingBranch = null;

  try {
    const preStatus = await git.status();
    const hasConflictingChanges = preStatus.files.some((file) => normalizeGitPath(file.path) !== dbFilePath);

    if (hasConflictingChanges) {
      console.warn('Skipping scraped-data push: working tree has changes outside the database file.');
      return { pushed: false, reason: 'conflicting_worktree_changes' };
    }

    const branches = await git.branchLocal();
    startingBranch = branches.current;

    if (!branches.all.includes('scraped-data')) {
      console.log('scraped-data branch does not exist locally. Creating it...');
      await git.checkoutLocalBranch('scraped-data');
    } else if (branches.current !== 'scraped-data') {
      console.log(`Current branch is "${branches.current}". Switching to "scraped-data" branch...`);
      await git.checkout('scraped-data');
    } else {
      console.log('Already on scraped-data branch.');
    }

    // Pull remote changes first to update the local branch.
    console.log('Pulling latest changes from remote...');
    await git.pull('origin', 'scraped-data', { '--rebase': 'true' });

    console.log(`Adding file: ${dbFilePath}`);
    await git.add([dbFilePath]);

    const stagedFiles = (await git.diff(['--cached', '--name-only']))
      .split('\n')
      .map((line) => normalizeGitPath(line.trim()))
      .filter(Boolean);

    if (!stagedFiles.includes(dbFilePath)) {
      console.log('No database changes detected after add; skipping commit/push.');
      if (startingBranch && startingBranch !== 'scraped-data') {
        await git.checkout(startingBranch);
      }
      return { pushed: false, reason: 'no_db_changes' };
    }

    console.log('Committing database changes...');
    await git.commit('Auto-update scraped data');

    console.log('Pushing changes to scraped-data branch...');
    await git.push('origin', 'scraped-data');
    console.log('Successfully pushed scraped data to scraped-data branch.');

    if (startingBranch && startingBranch !== 'scraped-data') {
      await git.checkout(startingBranch);
      console.log(`Returned to original branch "${startingBranch}".`);
    }

    return { pushed: true };
  } catch (error) {
    console.error('Error pushing scraped data:', error);
    try {
      if (startingBranch && startingBranch !== 'scraped-data') {
        await git.checkout(startingBranch);
      }
    } catch (checkoutError) {
      console.error('Failed to restore original branch after push failure:', checkoutError);
    }
    return { pushed: false, reason: 'error', error };
  }
}

module.exports = { pushToScrapedData };
