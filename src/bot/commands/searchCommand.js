const { MessageFlags } = require('discord.js');
const { summarizeError } = require('../../utils/errorSummary');
const {
  attachSearchInteractionCollector,
} = require('../handlers/searchInteractionCollector');
const {
  createSearchState,
} = require('../handlers/searchInteractionActions');
const {
  buildSearchViewPayload,
} = require('../utils/searchInteractionView');
const { normalizeSearchCriteria, validateSearchCriteria } = require('../utils/searchCriteria');

async function handleSearchCommand(interaction, dependencies) {
  const location = interaction.options.getString('location') || 'all';
  const criteria = normalizeSearchCriteria({
    make: interaction.options.getString('make'),
    model: interaction.options.getString('model'),
    yearRange: interaction.options.getString('year'),
    status: interaction.options.getString('status'),
  });

  try {
    await interaction.deferReply(validateSearchCriteria(criteria) ? { flags: MessageFlags.Ephemeral } : undefined);
    const initialSearchState = await createSearchState(location, criteria, dependencies);
    const message = await interaction.editReply(buildSearchViewPayload(initialSearchState, criteria));

    attachSearchInteractionCollector({
      message,
      ownerId: interaction.user.id,
      initialSearchState,
      criteria,
    }, dependencies);
  } catch (error) {
    console.error('Error querying vehicles:', summarizeError(error));
    await interaction.editReply({
      content: 'Error fetching data from the database.',
    });
  }
}

module.exports = { handleSearchCommand };
