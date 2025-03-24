// pushToScrapedData.js
const simpleGit = require('simple-git');
const path = require('path');
const git = simpleGit();

// Compute the absolute path for the database file.
// Adjust the relative path as needed based on your folder structure.
const dbFilePath = path.resolve(__dirname, '../../src/bot/vehicleInventory.db');

async function pushToScrapedData() {
  console.log('pushToScrapedData: function started.');
  try {
    const branches = await git.branchLocal();

    if (!branches.all.includes('scraped-data')) {
      console.log('scraped-data branch does not exist locally. Creating it...');
      await git.checkoutLocalBranch('scraped-data');
    } else if (branches.current !== 'scraped-data') {
      console.log(`Current branch is "${branches.current}". Switching to "scraped-data" branch...`);
      await git.checkout('scraped-data', ['--force']);
    } else {
      console.log('Already on scraped-data branch.');
    }

    // Pull remote changes first to update the local branch.
    console.log('Pulling latest changes from remote...');
    await git.pull('origin', 'scraped-data', { '--rebase': 'true' });

    console.log(`Adding file: ${dbFilePath}`);
    await git.add([dbFilePath]);

    console.log('Committing changes (allowing empty commit if needed)...');
    await git.commit('Auto-update scraped data', undefined, ['--allow-empty']);

    console.log('Pushing changes to scraped-data branch...');
    await git.push('origin', 'scraped-data');
    console.log('Successfully pushed scraped data to scraped-data branch.');
    console.log('Remaining on scraped-data branch.');
  } catch (error) {
    console.error('Error pushing scraped data:', error);
  }
}

module.exports = { pushToScrapedData };
