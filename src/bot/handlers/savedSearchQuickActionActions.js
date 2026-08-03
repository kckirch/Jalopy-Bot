const { convertYardIdToLocation } = require('../utils/locationUtils');
const { matchesSavedSearchCriteria } = require('../utils/savedSearchCriteria');
const {
  buildQuickActionButtons,
  buildRunNowEmbed,
  buildSavedSearchActionEmbed,
  createQuickActionPayload,
  normalizeLocationName,
} = require('../utils/savedSearchQuickActions');

function resolveSavedIndex(payload) {
  const parsedIndex = Number.parseInt(payload.idx, 10);
  return Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
}

function createCurrentActionPayload(interaction, payload, savedIndex) {
  return createQuickActionPayload({
    userId: interaction.user.id,
    location: payload.lc || normalizeLocationName(payload.yd, payload.yd),
    yardId: payload.yd,
    make: payload.mk || 'ANY',
    model: payload.md || 'ANY',
    yearRange: payload.yr || 'ANY',
    status: payload.st || 'ACTIVE',
    savedSearchId: payload.sid || '',
    savedIndex,
  });
}

function createSavedSearchPayload(interaction, savedSearch, savedIndex) {
  return createQuickActionPayload({
    userId: interaction.user.id,
    location: normalizeLocationName(
      convertYardIdToLocation(savedSearch.yard_id),
      savedSearch.yard_id
    ),
    yardId: savedSearch.yard_id,
    make: savedSearch.make,
    model: savedSearch.model,
    yearRange: savedSearch.year_range,
    status: savedSearch.status,
    savedSearchId: savedSearch.id,
    savedIndex,
  });
}

function formatDeletedSearchCount(deletedCount) {
  return `${deletedCount} saved search${deletedCount === 1 ? '' : 'es'}`;
}

async function closeQuickAction(interaction) {
  await interaction.update({
    content: 'Saved search actions closed.',
    embeds: [],
    components: [],
  });
}

async function runQuickAction(interaction, payload, dependencies) {
  const vehicles = await dependencies.queryVehicles(
    payload.yd,
    payload.mk || 'ANY',
    payload.md || 'ANY',
    payload.yr || 'ANY',
    payload.st || 'ACTIVE'
  );
  const savedIndex = resolveSavedIndex(payload);
  const refreshedPayload = createCurrentActionPayload(
    interaction,
    payload,
    savedIndex
  );

  await interaction.update({
    embeds: [buildRunNowEmbed(payload, vehicles)],
    components: [buildQuickActionButtons(refreshedPayload)],
  });
}

async function deleteMatchingSearches(payload, savedSearches, dependencies) {
  if (payload.sid) {
    await dependencies.deleteSavedSearch(payload.sid);
    return 1;
  }

  const matches = savedSearches.filter((savedSearch) =>
    matchesSavedSearchCriteria(savedSearch, {
      yardId: payload.yd,
      make: payload.mk,
      model: payload.md,
      yearRange: payload.yr,
      status: payload.st,
    })
  );
  for (const savedSearch of matches) {
    await dependencies.deleteSavedSearch(savedSearch.id);
  }
  return matches.length;
}

async function deleteQuickAction(
  interaction,
  payload,
  savedSearches,
  dependencies
) {
  const deletedCount = await deleteMatchingSearches(
    payload,
    savedSearches,
    dependencies
  );
  const remainingSavedSearches = await dependencies.getSavedSearches(
    interaction.user.id
  );
  const deletedDescription = `Deleted ${formatDeletedSearchCount(deletedCount)}.`;

  if (remainingSavedSearches.length === 0) {
    await interaction.update({
      content: `${deletedDescription} You have no saved searches left.`,
      embeds: [],
      components: [],
    });
    return;
  }

  const selectedIndex = Math.min(
    resolveSavedIndex(payload),
    remainingSavedSearches.length - 1
  );
  const selectedPayload = createSavedSearchPayload(
    interaction,
    remainingSavedSearches[selectedIndex],
    selectedIndex
  );
  const embed = buildSavedSearchActionEmbed({
    title: 'Saved Search Deleted',
    message: deletedDescription,
    payload: selectedPayload,
    savedCount: remainingSavedSearches.length,
    selectedPosition: selectedIndex + 1,
  });
  await interaction.update({
    embeds: [embed],
    components: [buildQuickActionButtons(selectedPayload)],
  });
}

async function browseQuickAction(interaction, payload, savedSearches) {
  const savedIndex = resolveSavedIndex(payload);
  const selectedIndex =
    payload.sa === 'next'
      ? (savedIndex + 1) % savedSearches.length
      : Math.min(savedIndex, savedSearches.length - 1);
  const selectedPayload = createSavedSearchPayload(
    interaction,
    savedSearches[selectedIndex],
    selectedIndex
  );
  const embed = buildSavedSearchActionEmbed({
    title: 'Saved Search',
    message:
      'Browse your saved searches with buttons and run or delete directly.',
    payload: selectedPayload,
    savedCount: savedSearches.length,
    selectedPosition: selectedIndex + 1,
  });
  await interaction.update({
    embeds: [embed],
    components: [buildQuickActionButtons(selectedPayload)],
  });
}

async function loadSavedSearches(interaction, dependencies) {
  const savedSearches = await dependencies.getSavedSearches(interaction.user.id);
  if (savedSearches.length > 0) return savedSearches;

  await interaction.update({
    content: 'You have no saved searches.',
    embeds: [],
    components: [],
  });
  return null;
}

async function executeSavedSearchQuickAction(
  interaction,
  payload,
  dependencies
) {
  if (payload.sa === 'close') {
    await closeQuickAction(interaction);
    return;
  }
  if (payload.sa === 'run') {
    await runQuickAction(interaction, payload, dependencies);
    return;
  }
  if (!['delete', 'view', 'next'].includes(payload.sa)) {
    await interaction.reply({
      content: 'Unsupported quick action.',
      ephemeral: true,
    });
    return;
  }

  const savedSearches = await loadSavedSearches(interaction, dependencies);
  if (!savedSearches) return;

  if (payload.sa === 'delete') {
    await deleteQuickAction(
      interaction,
      payload,
      savedSearches,
      dependencies
    );
    return;
  }
  await browseQuickAction(interaction, payload, savedSearches);
}

module.exports = { executeSavedSearchQuickAction };
