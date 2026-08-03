const { queryVehicles } = require('../../database/vehicleQueryManager');
const {
  deleteSavedSearch,
  getSavedSearches,
} = require('../../database/savedSearchManager');
const { resolveQuickActionPayload } = require('../utils/interactionParameters');
const { convertYardIdToLocation } = require('../utils/locationUtils');
const { matchesSavedSearchCriteria } = require('../utils/savedSearchCriteria');
const {
  buildQuickActionButtons,
  buildRunNowEmbed,
  buildSavedSearchActionEmbed,
  createQuickActionPayload,
  normalizeLocationName,
} = require('../utils/savedSearchQuickActions');

async function handleSavedSearchQuickActionButton(interaction, quickHash) {
  const payload = resolveQuickActionPayload(quickHash);
  if (!payload) {
    await interaction.reply({
      content: 'This action expired. Please save the search again.',
      ephemeral: true,
    });
    return;
  }
  const action = payload.sa;

  if (payload.uid && payload.uid !== interaction.user.id) {
    await interaction.reply({
      content: 'You do not have permission to use this action.',
      ephemeral: true,
    });
    return;
  }

  const currentLocation =
    payload.lc || normalizeLocationName(payload.yd, payload.yd);
  const currentYardId = payload.yd;
  const currentMake = payload.mk || 'ANY';
  const currentModel = payload.md || 'ANY';
  const currentYearRange = payload.yr || 'ANY';
  const currentStatus = payload.st || 'ACTIVE';
  const currentIndex = Number.parseInt(payload.idx, 10);
  const normalizedIndex =
    Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0;

  if (action === 'close') {
    await interaction.update({
      content: 'Saved search actions closed.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === 'run') {
    const vehicles = await queryVehicles(
      currentYardId,
      currentMake,
      currentModel,
      currentYearRange,
      currentStatus
    );
    const runNowEmbed = buildRunNowEmbed(payload, vehicles);
    const refreshedPayload = createQuickActionPayload({
      userId: interaction.user.id,
      location: currentLocation,
      yardId: currentYardId,
      make: currentMake,
      model: currentModel,
      yearRange: currentYearRange,
      status: currentStatus,
      savedSearchId: payload.sid || '',
      savedIndex: normalizedIndex,
    });
    await interaction.update({
      embeds: [runNowEmbed],
      components: [buildQuickActionButtons(refreshedPayload)],
    });
    return;
  }

  const savedSearches = await getSavedSearches(interaction.user.id);
  if (savedSearches.length === 0) {
    await interaction.update({
      content: 'You have no saved searches.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === 'delete') {
    let deletedCount;
    if (payload.sid) {
      await deleteSavedSearch(payload.sid);
      deletedCount = 1;
    } else {
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
        await deleteSavedSearch(savedSearch.id);
      }
      deletedCount = matches.length;
    }

    const remainingSavedSearches = await getSavedSearches(interaction.user.id);
    if (remainingSavedSearches.length === 0) {
      await interaction.update({
        content: `Deleted ${deletedCount} saved search${
          deletedCount === 1 ? '' : 'es'
        }. You have no saved searches left.`,
        embeds: [],
        components: [],
      });
      return;
    }

    const nextIndex = Math.min(
      normalizedIndex,
      remainingSavedSearches.length - 1
    );
    const nextSaved = remainingSavedSearches[nextIndex];
    const nextPayload = createQuickActionPayload({
      userId: interaction.user.id,
      location: normalizeLocationName(
        convertYardIdToLocation(nextSaved.yard_id),
        nextSaved.yard_id
      ),
      yardId: nextSaved.yard_id,
      make: nextSaved.make,
      model: nextSaved.model,
      yearRange: nextSaved.year_range,
      status: nextSaved.status,
      savedSearchId: nextSaved.id,
      savedIndex: nextIndex,
    });
    const embed = buildSavedSearchActionEmbed({
      title: 'Saved Search Deleted',
      message: `Deleted ${deletedCount} saved search${
        deletedCount === 1 ? '' : 'es'
      }.`,
      payload: nextPayload,
      savedCount: remainingSavedSearches.length,
      selectedPosition: nextIndex + 1,
    });
    await interaction.update({
      embeds: [embed],
      components: [buildQuickActionButtons(nextPayload)],
    });
    return;
  }

  if (action === 'view' || action === 'next') {
    const selectedIndex =
      action === 'next'
        ? (normalizedIndex + 1) % savedSearches.length
        : Math.min(normalizedIndex, savedSearches.length - 1);
    const selectedSavedSearch = savedSearches[selectedIndex];
    const selectedPayload = createQuickActionPayload({
      userId: interaction.user.id,
      location: normalizeLocationName(
        convertYardIdToLocation(selectedSavedSearch.yard_id),
        selectedSavedSearch.yard_id
      ),
      yardId: selectedSavedSearch.yard_id,
      make: selectedSavedSearch.make,
      model: selectedSavedSearch.model,
      yearRange: selectedSavedSearch.year_range,
      status: selectedSavedSearch.status,
      savedSearchId: selectedSavedSearch.id,
      savedIndex: selectedIndex,
    });
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
    return;
  }

  await interaction.reply({
    content: 'Unsupported quick action.',
    ephemeral: true,
  });
}

module.exports = { handleSavedSearchQuickActionButton };
