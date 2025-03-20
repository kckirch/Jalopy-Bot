// pushToScrapedData.js
const simpleGit = require('simple-git');
const git = simpleGit();

async function pushToScrapedData() {
  try {
    // Check out the scraped-data branch.
    // If the branch does not exist locally, create it.
    const branches = await git.branchLocal();
    if (!branches.all.includes('scraped-data')) {
      await git.checkoutLocalBranch('scraped-data');
    } else {
      await git.checkout('scraped-data');
    }

    // Add the updated database file.
    // Adjust the file path if necessary.
    await git.add(['vehicleInventory.db']);

    // Commit the changes with a message.
    await git.commit('Auto-update scraped data', undefined, ['--allow-empty']);

    // Push changes to the scraped-data branch.
    await git.push('origin', 'scraped-data');

    console.log('Successfully pushed scraped data to scraped-data branch.');

    // Optionally, switch back to main if your process requires it.
    await git.checkout('main');
  } catch (error) {
    console.error('Error pushing scraped data:', error);
  }
}

module.exports = { pushToScrapedData };
