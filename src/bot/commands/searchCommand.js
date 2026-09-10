const { EmbedBuilder } = require('discord.js');
const { summarizeError } = require('../../utils/errorSummary');
const {
  vehicleMakes,
  reverseMakeAliases,
} = require('../../config/vehicleMakes');
const {
  attachSearchInteractionCollector,
} = require('../handlers/searchInteractionCollector');
const {
  createSearchState,
} = require('../handlers/searchInteractionActions');
const {
  buildSearchViewPayload,
} = require('../utils/searchInteractionView');
const { normalizeModelForLooseComparison, parseYearInput } = require('../../database/vehicleSearchNormalization');

function normalizeSearchCriteria(interaction) {
  return {
    make: (interaction.options.getString('make') || 'Any').trim().toUpperCase(),
    model: (interaction.options.getString('model') || 'Any').trim().toUpperCase(),
    yearRange: (interaction.options.getString('year') || 'Any').trim().toUpperCase(),
    status: (interaction.options.getString('status') || 'ACTIVE').toUpperCase(),
  };
}

async function validateMake(interaction, criteria) {
  if (criteria.make === 'ANY' || vehicleMakes.includes(criteria.make)) {
    return true;
  }

  const canonicalMake = reverseMakeAliases[criteria.make];
  if (canonicalMake && vehicleMakes.includes(canonicalMake.toUpperCase())) {
    criteria.make = canonicalMake;
    return true;
  }

  const makesEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('Available Vehicle Makes')
    .setDescription(
      'The make you entered is not recognized. Please choose from the list below.'
    )
    .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });

  await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
  return false;
}

async function handleSearchCommand(interaction, dependencies) {
  const location = interaction.options.getString('location') || 'all';
  const criteria = normalizeSearchCriteria(interaction);

  if (!(await validateMake(interaction, criteria))) {
    return;
  }
  try {
    parseYearInput(criteria.yearRange, { strict: true });
  } catch (error) {
    await interaction.reply({ content: error.message, ephemeral: true });
    return;
  }
  if (!normalizeModelForLooseComparison(criteria.model)) {
    await interaction.reply({
      content: 'Enter a model name or leave model blank to search all models.',
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply();
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
