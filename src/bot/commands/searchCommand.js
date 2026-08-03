const { queryVehicles, getModelSuggestionsForNoResults } = require('../../database/vehicleQueryManager');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { vehicleMakes, reverseMakeAliases, convertLocationToYardId, convertYardIdToLocation } = require('../utils/locationUtils');
const { checkExistingSearch, addSavedSearch, getSavedSearches, deleteSavedSearch } = require('../../database/savedSearchManager');
const { summarizeError } = require('../../utils/errorSummary');
const {
  resolveInteractionParameters,
  storeInteractionParameters,
} = require('../utils/interactionParameters');
const {
  buildSearchResultsEmbed,
  getSearchResultPageCount,
  sortVehiclesForSearchView,
} = require('../utils/vehicleSearchResults');
const {
  canonicalizeYardIdForSavedSearch,
  matchesSavedSearchCriteria,
  serializeYardId,
} = require('../utils/savedSearchCriteria');
const { SEARCH_LOCATION_CHOICES } = require('../locationChoices');
const {
  buildSavedSearchActionMessage,
  formatSavedSearchPreview,
} = require('../utils/savedSearchQuickActions');

async function handleSearchCommand(interaction) {
  const location = interaction.options.getString('location');
  let userMakeInput = (interaction.options.getString('make') || 'Any').toUpperCase();
  let model = (interaction.options.getString('model') || 'Any').toUpperCase();
  let yearInput = (interaction.options.getString('year') || 'Any');
  let status = (interaction.options.getString('status') || 'ACTIVE').toUpperCase();

  if (userMakeInput !== 'ANY' && !vehicleMakes.includes(userMakeInput)) {
    const canonicalMake = reverseMakeAliases[userMakeInput];
    if (canonicalMake && vehicleMakes.includes(canonicalMake.toUpperCase())) {
      userMakeInput = canonicalMake;
    } else {
      const makesEmbed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('Available Vehicle Makes')
        .setDescription('The make you entered is not recognized. Please choose from the list below.')
        .addFields({ name: 'Valid Makes', value: vehicleMakes.join(', ') });

      await interaction.reply({ embeds: [makesEmbed], ephemeral: true });
      return;
    }
  }

  if (location) {
    try {
      const runSearchForLocation = async (targetLocation) => {
        const targetYardId = convertLocationToYardId(targetLocation);
        const targetVehicles = await queryVehicles(targetYardId, userMakeInput, model, yearInput, status);
        const suggestedModels = (targetVehicles.length === 0 && model !== 'ANY')
          ? await getModelSuggestionsForNoResults(userMakeInput, model, targetYardId, 8)
          : [];
        const sortedVehicles = sortVehiclesForSearchView(targetVehicles);
        return {
          location: targetLocation,
          yardId: targetYardId,
          vehicles: sortedVehicles,
          suggestedModels,
          currentPage: 0,
          totalPages: getSearchResultPageCount(sortedVehicles),
        };
      };

      let searchState = await runSearchForLocation(location);

      const getPage = (state) => buildSearchResultsEmbed({
        location: state.location,
        make: userMakeInput,
        model,
        yearRange: yearInput,
        status,
        vehicles: state.vehicles,
        currentPage: state.currentPage,
        totalPages: state.totalPages,
        suggestedModels: state.suggestedModels,
      });

      const updateComponents = (state, userId) => {
        try {
          const createCustomId = (action) => {
            const serializedYardId = serializeYardId(state.yardId);
            const parameters = `pg:${state.currentPage}|act:${action}|uid:${userId}|lc:${state.location}|yd:${serializedYardId}|mk:${userMakeInput}|md:${model}|yr:${yearInput}|st:${status}`;
            return storeInteractionParameters(parameters);
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
                  SEARCH_LOCATION_CHOICES.map((option) => ({
                    label: option.name,
                    value: option.value,
                    default: option.value === state.location,
                  }))
                )
            );

          return [pagingRow, savedSearchActionsRow, locationRow];
        } catch (error) {
          console.error('Error creating custom ID:', summarizeError(error));
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
          const parameters = resolveInteractionParameters(i.customId);
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
              try {
                const cleanedYardId = canonicalizeYardIdForSavedSearch(searchState.yardId);
                const cleanedYardName = convertYardIdToLocation(cleanedYardId).replace(/\s{2,}/g, ' ').trim();

                const exists = await checkExistingSearch(i.user.id, cleanedYardId, userMakeInput, model, yearInput, status);
                if (!exists) {
                  const savedSearchId = await addSavedSearch(i.user.id, i.user.tag, cleanedYardId, cleanedYardName, userMakeInput, model, yearInput, status, '');
                  const savedSearches = await getSavedSearches(i.user.id);
                  const responsePayload = buildSavedSearchActionMessage({
                    userId: i.user.id,
                    location: searchState.location,
                    yardId: cleanedYardId,
                    make: userMakeInput,
                    model,
                    yearRange: yearInput,
                    status,
                    savedSearchId,
                    savedSearches,
                    title: 'Search Saved',
                    message: 'Saved this search. Use the buttons below to keep working without retyping.',
                  });
                  await i.reply(responsePayload);
                } else {
                  const savedSearches = await getSavedSearches(i.user.id);
                  const responsePayload = buildSavedSearchActionMessage({
                    userId: i.user.id,
                    location: searchState.location,
                    yardId: cleanedYardId,
                    make: userMakeInput,
                    model,
                    yearRange: yearInput,
                    status,
                    savedSearches,
                    title: 'Search Already Saved',
                    message: 'This search is already in your saved list. You can run it now, jump through saved searches, or delete it.',
                  });
                  await i.reply(responsePayload);
                }
              } catch (error) {
                console.error('Error checking for existing search:', summarizeError(error));
                await i.reply({ content: 'Error checking for existing searches.', ephemeral: true });
              }
              break;
            case 'unsave':
              try {
                const cleanedYardId = canonicalizeYardIdForSavedSearch(searchState.yardId);
                const savedSearches = await getSavedSearches(i.user.id);
                const matchingSearches = savedSearches.filter((savedSearch) =>
                  matchesSavedSearchCriteria(savedSearch, {
                    yardId: cleanedYardId,
                    make: userMakeInput,
                    model,
                    yearRange: yearInput,
                    status,
                  })
                );

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
                console.error(
                  'Error deleting saved search from quick action:',
                  summarizeError(error)
                );
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
                  console.error('Unable to DM saved searches:', summarizeError(dmError));
                  await i.reply({
                    content: 'I could not DM you. Please enable DMs or use /savedsearch.',
                    ephemeral: true,
                  });
                }
              } catch (error) {
                console.error(
                  'Error listing saved searches from quick action:',
                  summarizeError(error)
                );
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
          console.error('Error processing button interaction:', summarizeError(error));
          await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
      });

      collector.on('end', () => {
        if (message) {
          message.edit({ components: [] });
        }
      });

    } catch (error) {
      console.error('Error querying vehicles:', summarizeError(error));
      await interaction.reply({ content: 'Error fetching data from the database.', ephemeral: true });
    }

  } else {
    await interaction.reply({ content: 'Location is required for this search.', ephemeral: true });
  }
}

module.exports = {
  handleSearchCommand,
};
