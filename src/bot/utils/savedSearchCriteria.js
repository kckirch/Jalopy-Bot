const { YARDS } = require('../../config/yards');

const ALL_YARD_IDS = Object.freeze(
  YARDS.map((yard) => yard.id).sort((left, right) => left - right)
);

function normalizeYardIdInput(input) {
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
}

function canonicalizeYardIdForSavedSearch(yardId) {
  if (yardId === 'ALL') {
    return ALL_YARD_IDS.join(',');
  }

  const normalizedIds = normalizeYardIdInput(yardId)
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));
  const uniqueSortedIds = [...new Set(normalizedIds)].sort(
    (left, right) => left - right
  );

  if (uniqueSortedIds.length > 0) {
    return uniqueSortedIds.join(',');
  }

  if (typeof yardId === 'string') {
    return yardId.replace(/\s+/g, '').trim();
  }

  return String(yardId);
}

function normalizeSavedSearchValue(value) {
  return String(value || '').trim().toUpperCase();
}

function matchesSavedSearchCriteria(
  savedSearch,
  { yardId, make, model, yearRange, status }
) {
  const savedYardId = canonicalizeYardIdForSavedSearch(savedSearch.yard_id);
  const criteriaYardId = canonicalizeYardIdForSavedSearch(yardId);

  return (
    normalizeSavedSearchValue(savedYardId) ===
      normalizeSavedSearchValue(criteriaYardId) &&
    normalizeSavedSearchValue(savedSearch.make) ===
      normalizeSavedSearchValue(make) &&
    normalizeSavedSearchValue(savedSearch.model) ===
      normalizeSavedSearchValue(model) &&
    normalizeSavedSearchValue(savedSearch.year_range) ===
      normalizeSavedSearchValue(yearRange) &&
    normalizeSavedSearchValue(savedSearch.status) ===
      normalizeSavedSearchValue(status)
  );
}

module.exports = {
  canonicalizeYardIdForSavedSearch,
  matchesSavedSearchCriteria,
  normalizeSavedSearchValue,
};
