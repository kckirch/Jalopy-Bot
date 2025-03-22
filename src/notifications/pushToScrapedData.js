// pushToScrapedData.js
const simpleGit = require('simple-git');
const path = require('path');
const git = simpleGit();

// Compute the absolute path for the database file.
// Adjust the relative path as needed based on your folder structure.
const dbFilePath = path.resolve(__dirname, '../../src/bot/vehicleInventory.db');

async function pushToScrapedData() {
  try {
    // Retrieve local branch information.
    const branches = await git.branchLocal();

    // If the 'scraped-data' branch does not exist, create it.
    if (!branches.all.includes('scraped-data')) {
      console.log('scraped-data branch does not exist locally. Creating it...');
      await git.checkoutLocalBranch('scraped-data');
    } else if (branches.current !== 'scraped-data') {
      console.log(`Current branch is "${branches.current}". Switching to "scraped-data" branch...`);
      // Force-checkout to scraped-data to override local changes if necessary.
      await git.checkout('scraped-data', ['--force']);
    } else {
      console.log('Already on scraped-data branch.');
    }

    // Add the updated database file.
    console.log(`Adding file: ${dbFilePath}`);
    await git.add([dbFilePath]);

    // Commit the changes with --allow-empty (so that an empty commit is made for testing if needed).
    console.log('Committing changes (allowing empty commit if needed)...');
    await git.commit('Auto-update scraped data', undefined, ['--allow-empty']);

    // Push changes to the scraped-data branch.
    console.log('Pushing changes to scraped-data branch...');
    await git.push('origin', 'scraped-data');
    console.log('Successfully pushed scraped data to scraped-data branch.');

    // We no longer switch back to main—stay on scraped-data.
    console.log('Remaining on scraped-data branch.');
  } catch (error) {
    console.error('Error pushing scraped data:', error);
  }
}

module.exports = { pushToScrapedData };
