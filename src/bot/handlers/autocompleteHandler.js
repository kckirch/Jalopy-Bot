const { vehicleMakes, reverseMakeAliases } = require('../utils/locationUtils');
const { getModelSuggestions } = require('../../database/vehicleQueryManager');

const AUTOCOMPLETE_LIMIT = 25;

function normalizeOptionValue(value) {
  return String(value || '').trim().toUpperCase();
}

function buildChoice(name, value = name) {
  const normalizedName = String(name).slice(0, 100);
  const normalizedValue = String(value).slice(0, 100);
  return {
    name: normalizedName,
    value: normalizedValue,
  };
}

function getMakeChoices(focusedValue) {
  const focused = normalizeOptionValue(focusedValue);
  const filtered = vehicleMakes
    .filter((make) => focused === '' || make.includes(focused))
    .slice(0, AUTOCOMPLETE_LIMIT);
  return filtered.map((make) => buildChoice(make, make));
}

function resolveMakeInput(rawMake) {
  const normalized = normalizeOptionValue(rawMake);
  if (!normalized || normalized === 'ANY') {
    return 'ANY';
  }
  const canonical = reverseMakeAliases[normalized];
  return canonical ? canonical.toUpperCase() : normalized;
}

async function getModelChoices(makeInput, focusedValue) {
  const focused = normalizeOptionValue(focusedValue);
  const make = resolveMakeInput(makeInput);
  const rows = await getModelSuggestions(make, focused, AUTOCOMPLETE_LIMIT);
  return rows.map((row) => buildChoice(row.model, row.model));
}

async function handleAutocompleteInteraction(interaction) {
  if (!interaction || typeof interaction.respond !== 'function') {
    return;
  }

  const commandName = interaction.commandName;
  if (commandName !== 'search' && commandName !== 'scrape') {
    return;
  }

  const focusedOption = interaction.options.getFocused(true);
  if (!focusedOption) {
    return interaction.respond([]);
  }

  try {
    if (focusedOption.name === 'make') {
      const choices = getMakeChoices(focusedOption.value);
      await interaction.respond(choices);
      return;
    }

    if (focusedOption.name === 'model') {
      const makeInput = interaction.options.getString('make');
      const choices = await getModelChoices(makeInput, focusedOption.value);
      await interaction.respond(choices);
      return;
    }

    await interaction.respond([]);
  } catch (error) {
    console.error('Autocomplete interaction error:', error);
    try {
      await interaction.respond([]);
    } catch (respondError) {
      console.error('Failed to respond to autocomplete interaction:', respondError);
    }
  }
}

module.exports = {
  handleAutocompleteInteraction,
  __testables: {
    getMakeChoices,
    getModelChoices,
    resolveMakeInput,
    normalizeOptionValue,
  },
};

