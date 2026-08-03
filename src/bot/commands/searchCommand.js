const { EmbedBuilder } = require('discord.js');
const { summarizeError } = require('../../utils/errorSummary');
const {
  vehicleMakes,
  reverseMakeAliases,
} = require('../utils/locationUtils');
const {
  attachSearchInteractionCollector,
} = require('../handlers/searchInteractionCollector');
const {
  createSearchState,
} = require('../handlers/searchInteractionActions');
const {
  buildSearchViewPayload,
} = require('../utils/searchInteractionView');

function normalizeSearchCriteria(interaction) {
  return {
    make: (interaction.options.getString('make') || 'Any').toUpperCase(),
    model: (interaction.options.getString('model') || 'Any').toUpperCase(),
    yearRange: interaction.options.getString('year') || 'Any',
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

async function handleSearchCommand(interaction) {
  const location = interaction.options.getString('location');
  const criteria = normalizeSearchCriteria(interaction);

  if (!(await validateMake(interaction, criteria))) {
    return;
  }
  if (!location) {
    await interaction.reply({
      content: 'Location is required for this search.',
      ephemeral: true,
    });
    return;
  }

  try {
    const initialSearchState = await createSearchState(location, criteria);
    const message = await interaction.reply({
      ...buildSearchViewPayload(
        initialSearchState,
        criteria,
        interaction.user.id
      ),
      fetchReply: true,
    });

    attachSearchInteractionCollector({
      message,
      ownerId: interaction.user.id,
      initialSearchState,
      criteria,
    });
  } catch (error) {
    console.error('Error querying vehicles:', summarizeError(error));
    await interaction.reply({
      content: 'Error fetching data from the database.',
      ephemeral: true,
    });
  }
}

module.exports = { handleSearchCommand };
