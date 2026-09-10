const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { buildSearchResultsEmbed } = require('./vehicleSearchResults');
const { SEARCH_LOCATION_CHOICES } = require('../locationChoices');
const { getSearchGroup } = require('../../database/vehicleSearchGroups');
const { normalizeModelForLooseComparison } = require('../../database/vehicleSearchNormalization');

function buildSearchPage(searchState, criteria) {
  if (searchState.validationError) {
    return new EmbedBuilder().setColor(0x0099ff).setTitle('Let’s fix this search')
      .setDescription(searchState.validationError.message);
  }
  const embed = buildSearchResultsEmbed({
    location: searchState.location,
    make: criteria.make,
    model: criteria.model,
    yearRange: criteria.yearRange,
    status: criteria.status,
    vehicles: searchState.vehicles,
    currentPage: searchState.currentPage,
    totalPages: searchState.totalPages,
    suggestedModels: searchState.suggestedModels,
    knownModel: searchState.knownModel,
  });
  if (searchState.vehicles.length === 0) {
    embed.setDescription(`${embed.data.description}\n\nUse the controls below to adjust these filters, or Save Alert to watch for matches.`);
  }
  if (searchState.groups?.some((group) => group.aliases?.includes(normalizeModelForLooseComparison(criteria.model)))) {
    embed.setDescription(`${embed.data.description}\n\nChoose the generation preset below to apply its model/year filters. The chassis itself is not verified.`);
  }
  return embed;
}

function buildValidationComponents(searchState, editButton) {
  const rows = [new ActionRowBuilder().addComponents(editButton)];
  if (searchState.suggestedMakes?.length) rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('search:make').setPlaceholder('Did you mean this make?')
      .addOptions(searchState.suggestedMakes.map((make) => ({ label: make, value: make })))
  ));
  return rows;
}

function buildSearchComponents(searchState, criteria) {
  const editButton = new ButtonBuilder().setCustomId('search:edit').setLabel('Edit Search').setStyle(ButtonStyle.Secondary);
  if (searchState.validationError) return buildValidationComponents(searchState, editButton);
  const pagingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('search:previous')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(
        searchState.currentPage === 0 || searchState.vehicles.length === 0
      ),
    new ButtonBuilder()
      .setCustomId('search:next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(
        searchState.vehicles.length === 0 ||
          searchState.currentPage >= searchState.totalPages - 1
      ),
    new ButtonBuilder()
      .setCustomId('search:save')
      .setLabel('Save Alert')
      .setStyle(ButtonStyle.Success)
  );

  const savedSearchActionsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('search:manage')
      .setLabel('Manage Alerts')
      .setStyle(ButtonStyle.Secondary)
  );
  savedSearchActionsRow.addComponents(editButton);
  if (searchState.vehicles.length === 0 && criteria.yearRange !== 'ANY' && !getSearchGroup(criteria.make, criteria.model)?.years) {
    savedSearchActionsRow.addComponents(new ButtonBuilder().setCustomId('search:any-year')
      .setLabel('Try Any Year').setStyle(ButtonStyle.Secondary));
  }
  if (searchState.vehicles.length === 0 && searchState.yardId !== 'ALL') {
    savedSearchActionsRow.addComponents(new ButtonBuilder().setCustomId('search:all-locations')
      .setLabel('Try All Locations').setStyle(ButtonStyle.Secondary));
  }

  const locationRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('search:relocate')
      .setPlaceholder('Run this search in another location')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        SEARCH_LOCATION_CHOICES.map((option) => ({
          label: option.name,
          value: option.value,
          default: option.value === searchState.location,
        }))
      )
  );

  const rows = [pagingRow, savedSearchActionsRow, locationRow];
  if (searchState.suggestedModels?.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('search:model')
        .setPlaceholder('Did you mean another model?')
        .addOptions(searchState.suggestedModels.map((model) => ({ label: model, value: model })))
    ));
  }
  if (searchState.groups?.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('search:group').setPlaceholder('Search a family or generation…')
        .addOptions(searchState.groups.map(({ label, value, description }) => ({ label, value, description })))
    ));
  }
  return rows;
}

function buildSearchViewPayload(searchState, criteria) {
  return {
    content: '',
    embeds: [buildSearchPage(searchState, criteria)],
    components: buildSearchComponents(searchState, criteria),
    allowedMentions: { parse: [] },
  };
}

function buildSearchEditModal(criteria, customId) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle('Edit Search');
  for (const [id, label, value] of [
    ['make', 'Make (blank = any)', criteria.make],
    ['model', 'Model or saved group (blank = any)', criteria.model],
    ['year', 'Years (e.g. 2006-2011; blank = any)', criteria.yearRange],
    ['status', 'Status: ACTIVE, NEW, or INACTIVE', criteria.status],
  ]) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short)
        .setRequired(false).setMaxLength(100).setValue(value.slice(0, 100))
    ));
  }
  return modal;
}

module.exports = { buildSearchViewPayload, buildSearchEditModal };
