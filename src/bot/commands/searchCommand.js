const { queryVehicles } = require('../../database/vehicleQueryManager');
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
        sortVehicles(targetVehicles);
        return {
          location: targetLocation,
          yardId: targetYardId,
          vehicles: targetVehicles,
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
          embed.setDescription('No Results Found.\n\nPlease double check your Model naming if you are certain it should be in the yard.\nRemember simpler is usually better :)')
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
                  await addSavedSearch(i.user.id, i.user.tag, cleanedYardId, cleanedYardName, userMakeInput, model, yearInput, status, '');
                  await i.reply({
                    content: 'Search saved successfully! Use **Delete Saved** or **My Saved Searches** below for quick actions.',
                    ephemeral: true,
                  });
                } else {
                  await i.reply({
                    content: 'This search has already been saved. Use **Delete Saved** below if you want to remove it.',
                    ephemeral: true,
                  });
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

module.exports = {
  handleSearchCommand,
  __testables: {
    canonicalizeYardIdForSavedSearch,
    generateHash,
    resolveHash,
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
