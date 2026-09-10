const { vehicleMakes, reverseMakeAliases } = require('../../config/vehicleMakes');
const { normalizeModelForLooseComparison, parseYearInput } = require('../../database/vehicleSearchNormalization');
const { getSearchGroup, isSearchGroupFilter } = require('../../database/vehicleSearchGroups');

function normalizeSearchCriteria({ make, model, yearRange, status }) {
  const normalizedMake = String(make || 'ANY').trim().toUpperCase();
  return {
    make: reverseMakeAliases[normalizedMake] || normalizedMake,
    model: String(model || 'ANY').trim().toUpperCase(),
    yearRange: String(yearRange || 'ANY').trim().toUpperCase() || 'ANY',
    status: String(status || 'ACTIVE').trim().toUpperCase() || 'ACTIVE',
  };
}

function validateSearchCriteria(criteria) {
  for (const field of ['make', 'model', 'yearRange']) {
    if (criteria[field].length > 100) return { field, message: 'Keep each search field to 100 characters or fewer. Use Edit Search to shorten it.' };
  }
  if (criteria.make !== 'ANY' && !vehicleMakes.includes(criteria.make)) {
    return { field: 'make', message: 'That make is not recognized. Choose a suggested make below, or use Edit Search. Your other filters will be kept.' };
  }
  try {
    parseYearInput(criteria.yearRange, { strict: true });
  } catch (error) {
    return { field: 'yearRange', message: `${error.message} Use Edit Search to fix the years.` };
  }
  if (!normalizeModelForLooseComparison(criteria.model)) {
    return { field: 'model', message: 'Enter a model name, or leave model blank for all models. Use Edit Search to try again.' };
  }
  if (isSearchGroupFilter(criteria.model) && !getSearchGroup(criteria.make, criteria.model)) {
    return { field: 'model', message: 'That family or generation is not available for this make. Use Edit Search to choose a model or ANY, then select a group.' };
  }
  if (!['ACTIVE', 'NEW', 'INACTIVE'].includes(criteria.status)) {
    return { field: 'status', message: 'Status must be ACTIVE, NEW, or INACTIVE. Use Edit Search to fix it.' };
  }
  return null;
}

module.exports = { normalizeSearchCriteria, validateSearchCriteria };
