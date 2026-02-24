const { queryVehicles, getModelSuggestionsForNoResults } = require('../../database/vehicleQueryManager');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { vehicleMakes, reverseMakeAliases, convertLocationToYardId, convertYardIdToLocation, yardIdMapping } = require('../utils/locationUtils');
const { checkExistingSearch, addSavedSearch, getSavedSearches, deleteSavedSearch } = require('../../database/savedSearchManager');
const crypto = require('crypto');

const parameterStore = new Map();
let parameterStoreMaxEntries = 5000;
let parameterStoreTtlMs = 10 * 60 * 1000;
let nowProvider = () => Date.now();
const SAVED_SEARCH_DM_PREVIEW_LIMIT = 15;
const QUICK_ACTION_PREFIX = 'sq:';

const SEARCH_LOCATION_OPTIONS = [
  { label: 'Boise', value: 'boise' },
  { label: 'Garden City', value: 'gardencity' },
  { label: 'Nampa', value: 'nampa' },
  { label: 'Caldwell', value: 'caldwell' },
  { label: 'Twin Falls', value: 'twinfalls' },
  { label: 'Trusty Pick A Part', value: 'trustypickapart' },
  { label: 'Treasure Valley Yards', value: 'treasurevalleyyards' },
  { label: 'All', value: 'all' },
];

function canonicalizeYardIdForSavedSearch(yardId) {
  const normalizeIds = (input) => {
    if (Array.isArray(input)) {
      return input;
    }
    if (typeof input === 'string' && input.includes(',')) {
      return input.split(',').map((id) => id.trim());
    }
    if (typeof input === 'number') {
      return [input];
    }
    if (typeof input === 'string' && input.trim() !== '') {
      return [input.trim()];
    }
    return [];
  };

  if (yardId === 'ALL') {
    const allYardIds = Object.values(yardIdMapping);
    return [...new Set(allYardIds)].sort((a, b) => a - b).join(',');
  }

  const normalized = normalizeIds(yardId)
    .map((id) => parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));
  const uniqueSorted = [...new Set(normalized)].sort((a, b) => a - b);

  if (uniqueSorted.length > 0) {
    return uniqueSorted.join(',');
  }

  if (typeof yardId === 'string') {
    return yardId.replace(/\s+/g, '').trim();
  }

  return String(yardId);
}

function pruneParameterStore() {
  const now = nowProvider();

  for (const [hash, entry] of parameterStore.entries()) {
    if (!entry || entry.expiresAt <= now) {
      parameterStore.delete(hash);
    }
  }

  while (parameterStore.size > parameterStoreMaxEntries) {
    const oldestKey = parameterStore.keys().next().value;
    if (!oldestKey) {
      break;
    }
    parameterStore.delete(oldestKey);
  }
}

function generateHash(parameters) {
  pruneParameterStore();
  const hash = crypto.createHash('md5').update(parameters).digest('hex');
  parameterStore.set(hash, {
    parameters,
    expiresAt: nowProvider() + parameterStoreTtlMs,
  });
  pruneParameterStore();
  return hash;
}

function resolveHash(hash) {
  const entry = parameterStore.get(hash);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= nowProvider()) {
    parameterStore.delete(hash);
    return undefined;
  }
  return entry.parameters;
}

function encodeParamValue(value) {
  return encodeURIComponent(String(value ?? ''));
}

function decodeParamValue(value) {
  try {
    return decodeURIComponent(String(value ?? ''));
  } catch (error) {
    return String(value ?? '');
  }
}

function serializeActionPayload(payload) {
  return Object.entries(payload)
    .map(([key, value]) => `${key}:${encodeParamValue(value)}`)
    .join('|');
}

function deserializeActionPayload(serializedPayload) {
  return String(serializedPayload || '')
    .split('|')
    .reduce((accumulator, pair) => {
      const separatorIndex = pair.indexOf(':');
      if (separatorIndex === -1) {
        return accumulator;
      }
      const key = pair.slice(0, separatorIndex);
      const value = pair.slice(separatorIndex + 1);
      accumulator[key] = decodeParamValue(value);
      return accumulator;
    }, {});
}

function buildQuickActionCustomId(action, payload) {
  const serialized = serializeActionPayload({
    ...payload,
    sa: action,
  });
  const hash = generateHash(serialized);
  return `${QUICK_ACTION_PREFIX}${hash}`;
}

function normalizeLocationName(location, yardId) {
  if (location && location.trim() !== '') {
    return location;
  }
  return convertYardIdToLocation(yardId).replace(/\s{2,}/g, ' ').trim();
}

function buildQuickActionButtons(payload) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('delete', payload))
      .setLabel('Delete This Search')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('view', payload))
      .setLabel('See Saved')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('next', payload))
      .setLabel('Next Saved')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('run', payload))
      .setLabel('Run This Search')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildQuickActionCustomId('close', payload))
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createQuickActionPayload({
  userId,
  location,
  yardId,
  make,
  model,
  yearRange,
  status,
  savedSearchId,
  savedIndex = 0,
}) {
  const canonicalYardId = canonicalizeYardIdForSavedSearch(yardId);
  return {
    uid: userId,
    lc: normalizeLocationName(location, canonicalYardId),
    yd: canonicalYardId,
    mk: make,
    md: model,
    yr: yearRange,
    st: status,
    sid: savedSearchId || '',
    idx: Number.isInteger(savedIndex) && savedIndex >= 0 ? savedIndex : 0,
  };
}

function matchesSavedSearchWithPayload(savedSearch, payload) {
  const savedYard = canonicalizeYardIdForSavedSearch(savedSearch.yard_id);
  const payloadYard = canonicalizeYardIdForSavedSearch(payload.yd);
  return (
    normalizeSearchValue(savedYard) === normalizeSearchValue(payloadYard) &&
    normalizeSearchValue(savedSearch.make) === normalizeSearchValue(payload.mk) &&
    normalizeSearchValue(savedSearch.model) === normalizeSearchValue(payload.md) &&
    normalizeSearchValue(savedSearch.year_range) === normalizeSearchValue(payload.yr) &&
    normalizeSearchValue(savedSearch.status) === normalizeSearchValue(payload.st)
  );
}

function buildSavedSearchActionEmbed({
  title,
  message,
  payload,
  savedCount,
  selectedPosition = null,
}) {
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(message)
    .addFields(
      { name: 'Location', value: payload.lc || 'Any', inline: true },
      { name: 'Make', value: payload.mk || 'ANY', inline: true },
      { name: 'Model', value: payload.md || 'ANY', inline: true },
      { name: 'Year', value: payload.yr || 'ANY', inline: true },
      { name: 'Status', value: payload.st || 'ACTIVE', inline: true }
    );

  if (Number.isInteger(savedCount)) {
    const positionText = Number.isInteger(selectedPosition) ? ` (showing ${selectedPosition} of ${savedCount})` : '';
    embed.addFields({
      name: 'Saved Searches',
      value: `${savedCount}${positionText}`,
      inline: true,
    });
  }

  return embed;
}

function buildRunNowEmbed(payload, vehicles) {
  const embed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('Run This Search')
    .setDescription(`Current match count: **${vehicles.length}**`)
    .addFields(
      { name: 'Location', value: payload.lc || 'Any', inline: true },
      { name: 'Make', value: payload.mk || 'ANY', inline: true },
      { name: 'Model', value: payload.md || 'ANY', inline: true },
      { name: 'Year', value: payload.yr || 'ANY', inline: true },
      { name: 'Status', value: payload.st || 'ACTIVE', inline: true }
    );

  const previewRows = vehicles.slice(0, 5);
  if (previewRows.length > 0) {
    const preview = previewRows
      .map((vehicle) => `${vehicle.vehicle_year} ${vehicle.vehicle_make} ${vehicle.vehicle_model} | ${vehicle.yard_name} Row ${vehicle.row_number}`)
      .join('\n')
      .slice(0, 1024);
    embed.addFields({ name: 'Top Matches', value: preview });
  } else {
    embed.addFields({ name: 'Top Matches', value: 'No active matches right now.' });
  }

  if (vehicles.length > previewRows.length) {
    embed.setFooter({ text: `Showing ${previewRows.length} of ${vehicles.length} matches` });
  }

  return embed;
}

async function buildSavedSearchActionMessage({
  userId,
  location,
  yardId,
  make,
  model,
  yearRange,
  status,
  savedSearchId = '',
  savedIndex = 0,
  title,
  message,
}) {
  const payload = createQuickActionPayload({
    userId,
    location,
    yardId,
    make,
    model,
    yearRange,
    status,
    savedSearchId,
    savedIndex,
  });

  const savedSearches = await getSavedSearches(userId);
  const selectedPosition = savedSearches.length > 0 ? (payload.idx + 1) : null;
  const embed = buildSavedSearchActionEmbed({
    title,
    message,
    payload,
    savedCount: savedSearches.length,
    selectedPosition,
  });

  return {
    embeds: [embed],
    components: [buildQuickActionButtons(payload)],
    ephemeral: true,
  };
}

function normalizeSearchValue(value) {
  return String(value || '').trim().toUpperCase();
}

function serializeYardId(yardId) {
  if (Array.isArray(yardId)) {
    return yardId.join(',');
  }
  return String(yardId);
}

function formatSavedSearchPreview(savedSearches) {
  const previewRows = savedSearches.slice(0, SAVED_SEARCH_DM_PREVIEW_LIMIT);
  const lines = previewRows.map((search) =>
    `- ${search.yard_name} | ${search.make} ${search.model} (${search.year_range}) | ${search.status}`
  );

  if (savedSearches.length > SAVED_SEARCH_DM_PREVIEW_LIMIT) {
    lines.push(`- ...and ${savedSearches.length - SAVED_SEARCH_DM_PREVIEW_LIMIT} more`);
  }

  return lines.join('\n');
}

async function handleSearchCommand(interaction) {
  const location = interaction.options.getString('location');
  let userMakeInput = (interaction.options.getString('make') || 'Any').toUpperCase();
  let model = (interaction.options.getString('model') || 'Any').toUpperCase();
  let yearInput = (interaction.options.getString('year') || 'Any');
  let status = (interaction.options.getString('status') || 'ACTIVE').toUpperCase();

  console.log('🔍 DB Lookup for:');
  console.log(`   🏞️ Location: ${location}`);
  console.log(`   🚗 Make: ${userMakeInput}`);
  console.log(`   📋 Model: ${model}`);
  console.log(`   📅 Year: ${yearInput}`);
  console.log(`   📊 Status: ${status}`);

  if (userMakeInput === 'ANY') {
    console.log('Make is empty, skipping validation.');
  } else {
    if (vehicleMakes.includes(userMakeInput)) {
      console.log(`Direct make found: ${userMakeInput}`);
    } else {
      const canonicalMake = reverseMakeAliases[userMakeInput];
      if (canonicalMake && vehicleMakes.includes(canonicalMake.toUpperCase())) {
        userMakeInput = canonicalMake;
        console.log(` 🚗 Canonical Make Found: ${canonicalMake}`);
      } else {
        const makesEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle('Available Vehicle Makes')
          .setDescription('The make you entered is not recognized. Please choose from the list below.')
          .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });

        await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
        console.log('No valid make found, search ended.');
        return;
      }
    }
  }

  if (location) {
    try {
      const itemsPerPage = 20;
      const sortVehicles = (rows) => rows.sort((a, b) => {
        const firstSeenA = new Date(a.first_seen);
        const firstSeenB = new Date(b.first_seen);
        return firstSeenB - firstSeenA || a.vehicle_model.localeCompare(b.vehicle_model);
      });

      const runSearchForLocation = async (targetLocation) => {
        const targetYardId = convertLocationToYardId(targetLocation);
        const targetVehicles = await queryVehicles(targetYardId, userMakeInput, model, yearInput, status);
        const suggestedModels = (targetVehicles.length === 0 && model !== 'ANY')
          ? await getModelSuggestionsForNoResults(userMakeInput, model, targetYardId, 8)
          : [];
        sortVehicles(targetVehicles);
        return {
          location: targetLocation,
          yardId: targetYardId,
          vehicles: targetVehicles,
          suggestedModels,
          currentPage: 0,
          totalPages: Math.ceil(targetVehicles.length / itemsPerPage),
        };
      };

      let searchState = await runSearchForLocation(location);

      const getPage = (state) => {
        const safePage = state.vehicles.length === 0
          ? 0
          : Math.min(Math.max(state.currentPage, 0), state.totalPages - 1);
        const start = safePage * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = state.vehicles.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`Database search results for ${state.location} ${userMakeInput || 'Any'} ${model} (${yearInput}) ${status}`)
          .setTimestamp();

        if (state.vehicles.length === 0) {
          let description = 'No Results Found.\n\nPlease double check your Model naming if you are certain it should be in the yard.\nRemember simpler is usually better :)';
          if (Array.isArray(state.suggestedModels) && state.suggestedModels.length > 0) {
            const suggestions = state.suggestedModels.slice(0, 8).join(', ');
            description += `\n\nPossible model names we have seen: ${suggestions}`;
          }
          embed
            .setDescription(description)
            .setFooter({ text: 'Page 0 of 0' });
        } else {
          embed.setFooter({ text: `Page ${safePage + 1} of ${state.totalPages}` });
          pageItems.forEach(v => {
            const firstSeen = new Date(v.first_seen);
            const lastUpdated = new Date(v.last_updated);
            const firstSeenFormatted = `${firstSeen.getMonth() + 1}/${firstSeen.getDate()}`;
            const lastUpdatedFormatted = `${lastUpdated.getMonth() + 1}/${lastUpdated.getDate()}`;
            let vehicleDescription = `Yard: ${v.yard_name}, Row: ${v.row_number}, First Seen: ${firstSeenFormatted}, Last Updated: ${lastUpdatedFormatted}`;


            if (v.notes) {
              vehicleDescription += `\nNotes: ${v.notes}`;
            }

            embed.addFields({
              name: `${v.vehicle_make} ${v.vehicle_model} (${v.vehicle_year})`,
              value: vehicleDescription,
              inline: false
            });
          });
        }

        return embed;
      };

      const updateComponents = (state, userId) => {
        try {
          const createCustomId = (action) => {
            const serializedYardId = serializeYardId(state.yardId);
            const parameters = `pg:${state.currentPage}|act:${action}|uid:${userId}|lc:${state.location}|yd:${serializedYardId}|mk:${userMakeInput}|md:${model}|yr:${yearInput}|st:${status}`;
            return generateHash(parameters);
          };

          const pagingRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(createCustomId('previous'))
                .setLabel('Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(state.currentPage === 0 || state.vehicles.length === 0),
              new ButtonBuilder()
                .setCustomId(createCustomId('next'))
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(
                  state.vehicles.length === 0 || state.currentPage >= state.totalPages - 1
                ),
              new ButtonBuilder()
                .setCustomId(createCustomId('save'))
                .setLabel('Save Search')
                .setStyle(ButtonStyle.Success)
                .setDisabled(false)
            );

          const savedSearchActionsRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(createCustomId('unsave'))
                .setLabel('Delete Saved')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId(createCustomId('savedlist'))
                .setLabel('My Saved Searches')
                .setStyle(ButtonStyle.Secondary)
            );

          const locationRow = new ActionRowBuilder()
            .addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(createCustomId('relocate'))
                .setPlaceholder('Run this search in another location')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(
                  SEARCH_LOCATION_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value,
                    default: option.value === state.location,
                  }))
                )
            );

          return [pagingRow, savedSearchActionsRow, locationRow];
        } catch (error) {
          console.error('Error creating custom ID:', error);
          throw error;
        }
      };

      const message = await interaction.reply({
        embeds: [getPage(searchState)],
        components: updateComponents(searchState, interaction.user.id),
        fetchReply: true,
      });

      const collector = message.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 120000 });

      collector.on('collect', async i => {
        try {
          const parameters = resolveHash(i.customId);
          if (!parameters) {
            await i.reply({ content: 'Invalid or expired interaction.', ephemeral: true });
            return;
          }

          const parts = parameters.split('|').reduce((acc, part) => {
            const [key, value] = part.split(':');
            acc[key] = value;
            return acc;
          }, {});

          const action = parts['act'];
          const userId = parts['uid'];

          if (userId !== i.user.id) {
            await i.reply({ content: "You do not have permission to perform this action.", ephemeral: true });
            return;
          }

          switch (action) {
            case 'next':
            case 'previous':
              if (action === 'next' && searchState.currentPage < searchState.totalPages - 1) {
                searchState.currentPage += 1;
              }
              if (action === 'previous' && searchState.currentPage > 0) {
                searchState.currentPage -= 1;
              }
              await i.update({
                embeds: [getPage(searchState)],
                components: updateComponents(searchState, userId)
              });
              break;

            case 'save':
              console.log(`Attempting to save or check existing search: YardID=${searchState.yardId}, Make=${userMakeInput}, Model=${model}, Year=${yearInput}, Status=${status}`);

              try {
                const cleanedYardId = canonicalizeYardIdForSavedSearch(searchState.yardId);
                const cleanedYardName = convertYardIdToLocation(cleanedYardId).replace(/\s{2,}/g, ' ').trim();

                const exists = await checkExistingSearch(i.user.id, cleanedYardId, userMakeInput, model, yearInput, status);
                if (!exists) {
                  const savedSearchId = await addSavedSearch(i.user.id, i.user.tag, cleanedYardId, cleanedYardName, userMakeInput, model, yearInput, status, '');
                  const responsePayload = await buildSavedSearchActionMessage({
                    userId: i.user.id,
                    location: searchState.location,
                    yardId: cleanedYardId,
                    make: userMakeInput,
                    model,
                    yearRange: yearInput,
                    status,
                    savedSearchId,
                    title: 'Search Saved',
                    message: 'Saved this search. Use the buttons below to keep working without retyping.',
                  });
                  await i.reply(responsePayload);
                } else {
                  const responsePayload = await buildSavedSearchActionMessage({
                    userId: i.user.id,
                    location: searchState.location,
                    yardId: cleanedYardId,
                    make: userMakeInput,
                    model,
                    yearRange: yearInput,
                    status,
                    title: 'Search Already Saved',
                    message: 'This search is already in your saved list. You can run it now, jump through saved searches, or delete it.',
                  });
                  await i.reply(responsePayload);
                }
              } catch (error) {
                console.error('Error checking for existing search:', error);
                await i.reply({ content: 'Error checking for existing searches.', ephemeral: true });
              }
              break;
            case 'unsave':
              try {
                const cleanedYardId = canonicalizeYardIdForSavedSearch(searchState.yardId);
                const savedSearches = await getSavedSearches(i.user.id);
                const matchingSearches = savedSearches.filter((savedSearch) => {
                  const savedYardId = canonicalizeYardIdForSavedSearch(savedSearch.yard_id);
                  return (
                    normalizeSearchValue(savedYardId) === normalizeSearchValue(cleanedYardId) &&
                    normalizeSearchValue(savedSearch.make) === normalizeSearchValue(userMakeInput) &&
                    normalizeSearchValue(savedSearch.model) === normalizeSearchValue(model) &&
                    normalizeSearchValue(savedSearch.year_range) === normalizeSearchValue(yearInput) &&
                    normalizeSearchValue(savedSearch.status) === normalizeSearchValue(status)
                  );
                });

                if (matchingSearches.length === 0) {
                  await i.reply({
                    content: 'This search is not currently saved.',
                    ephemeral: true,
                  });
                  break;
                }

                for (const savedSearch of matchingSearches) {
                  await deleteSavedSearch(savedSearch.id);
                }

                const pluralSuffix = matchingSearches.length === 1 ? '' : 'es';
                await i.reply({
                  content: `Removed ${matchingSearches.length} matching saved search${pluralSuffix}.`,
                  ephemeral: true,
                });
              } catch (error) {
                console.error('Error deleting saved search from quick action:', error);
                await i.reply({
                  content: 'Error deleting saved search.',
                  ephemeral: true,
                });
              }
              break;
            case 'savedlist':
              try {
                const savedSearches = await getSavedSearches(i.user.id);
                if (savedSearches.length === 0) {
                  await i.reply({
                    content: 'You currently have no saved searches.',
                    ephemeral: true,
                  });
                  break;
                }

                const previewText = formatSavedSearchPreview(savedSearches);
                try {
                  await i.user.send({
                    content: `Your saved searches (${savedSearches.length}):\n${previewText}\n\nUse /savedsearch to page through and delete specific entries.`,
                  });
                  await i.reply({
                    content: `Sent ${savedSearches.length} saved search(es) to your DMs.`,
                    ephemeral: true,
                  });
                } catch (dmError) {
                  console.error('Unable to DM saved searches:', dmError);
                  await i.reply({
                    content: 'I could not DM you. Please enable DMs or use /savedsearch.',
                    ephemeral: true,
                  });
                }
              } catch (error) {
                console.error('Error listing saved searches from quick action:', error);
                await i.reply({
                  content: 'Error retrieving saved searches.',
                  ephemeral: true,
                });
              }
              break;
            case 'relocate': {
              const selectedLocation = Array.isArray(i.values) ? i.values[0] : null;
              if (!selectedLocation) {
                await i.reply({ content: 'No location selected.', ephemeral: true });
                break;
              }

              searchState = await runSearchForLocation(selectedLocation);
              await i.update({
                embeds: [getPage(searchState)],
                components: updateComponents(searchState, userId),
              });
              break;
            }
            default:
              await i.reply({ content: 'Unsupported action.', ephemeral: true });
              break;
          }
        } catch (error) {
          console.error('Error processing button interaction:', error);
          await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
      });

      collector.on('end', () => {
        if (message) {
          message.edit({ components: [] });
        }
      });

    } catch (error) {
      console.error('Error querying vehicles:', error);
      await interaction.reply({ content: 'Error fetching data from the database.', ephemeral: true });
    }

  } else {
    await interaction.reply({ content: 'Location is required for this search.', ephemeral: true });
  }
}

async function handleSavedSearchQuickActionButton(interaction, quickHash) {
  const serializedPayload = resolveHash(quickHash);
  if (!serializedPayload) {
    await interaction.reply({ content: 'This action expired. Please save the search again.', ephemeral: true });
    return;
  }

  const payload = deserializeActionPayload(serializedPayload);
  const action = payload.sa;

  if (payload.uid && payload.uid !== interaction.user.id) {
    await interaction.reply({ content: 'You do not have permission to use this action.', ephemeral: true });
    return;
  }

  const currentLocation = payload.lc || normalizeLocationName(payload.yd, payload.yd);
  const currentYardId = payload.yd;
  const currentMake = payload.mk || 'ANY';
  const currentModel = payload.md || 'ANY';
  const currentYearRange = payload.yr || 'ANY';
  const currentStatus = payload.st || 'ACTIVE';
  const currentIndex = Number.parseInt(payload.idx, 10);
  const normalizedIndex = Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0;

  if (action === 'close') {
    await interaction.update({ content: 'Saved search actions closed.', embeds: [], components: [] });
    return;
  }

  if (action === 'run') {
    const vehicles = await queryVehicles(currentYardId, currentMake, currentModel, currentYearRange, currentStatus);
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
    await interaction.update({ content: 'You have no saved searches.', embeds: [], components: [] });
    return;
  }

  if (action === 'delete') {
    let deletedCount = 0;
    if (payload.sid) {
      await deleteSavedSearch(payload.sid);
      deletedCount = 1;
    } else {
      const matches = savedSearches.filter((savedSearch) => matchesSavedSearchWithPayload(savedSearch, payload));
      for (const savedSearch of matches) {
        await deleteSavedSearch(savedSearch.id);
      }
      deletedCount = matches.length;
    }

    const remainingSavedSearches = await getSavedSearches(interaction.user.id);
    if (remainingSavedSearches.length === 0) {
      await interaction.update({
        content: `Deleted ${deletedCount} saved search${deletedCount === 1 ? '' : 'es'}. You have no saved searches left.`,
        embeds: [],
        components: [],
      });
      return;
    }

    const nextIndex = Math.min(normalizedIndex, remainingSavedSearches.length - 1);
    const nextSaved = remainingSavedSearches[nextIndex];
    const nextPayload = createQuickActionPayload({
      userId: interaction.user.id,
      location: normalizeLocationName(convertYardIdToLocation(nextSaved.yard_id), nextSaved.yard_id),
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
      message: `Deleted ${deletedCount} saved search${deletedCount === 1 ? '' : 'es'}.`,
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
    const selectedIndex = action === 'next'
      ? (normalizedIndex + 1) % savedSearches.length
      : Math.min(normalizedIndex, savedSearches.length - 1);
    const selectedSavedSearch = savedSearches[selectedIndex];
    const selectedPayload = createQuickActionPayload({
      userId: interaction.user.id,
      location: normalizeLocationName(convertYardIdToLocation(selectedSavedSearch.yard_id), selectedSavedSearch.yard_id),
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
      message: 'Browse your saved searches with buttons and run or delete directly.',
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

  await interaction.reply({ content: 'Unsupported quick action.', ephemeral: true });
}

module.exports = {
  handleSearchCommand,
  handleSavedSearchQuickActionButton,
  __testables: {
    QUICK_ACTION_PREFIX,
    canonicalizeYardIdForSavedSearch,
    generateHash,
    resolveHash,
    buildQuickActionCustomId,
    deserializeActionPayload,
    pruneParameterStore,
    resetParameterStore: () => parameterStore.clear(),
    getParameterStoreSize: () => parameterStore.size,
    setParameterStoreConfig: ({ maxEntries, ttlMs } = {}) => {
      if (Number.isInteger(maxEntries) && maxEntries > 0) {
        parameterStoreMaxEntries = maxEntries;
      }
      if (Number.isInteger(ttlMs) && ttlMs > 0) {
        parameterStoreTtlMs = ttlMs;
      }
    },
    setNowProvider: (fn) => {
      nowProvider = typeof fn === 'function' ? fn : () => Date.now();
    },
    resetNowProvider: () => {
      nowProvider = () => Date.now();
    },
  },
};
