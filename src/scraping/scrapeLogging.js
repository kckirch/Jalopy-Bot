const { normalizeYardId } = require('./yardIdNormalization');

const DEFAULT_MAX_LOG_VALUE_LENGTH = 80;

function isUnsafeLogCharacter(character) {
  const codePoint = character.codePointAt(0);
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function replaceUnsafeLogCharacters(value) {
  return Array.from(String(value ?? ''))
    .map((character) => (isUnsafeLogCharacter(character) ? ' ' : character))
    .join('');
}

function formatScrapeLogValue(
  value,
  { fallback = 'unknown', maxLength = DEFAULT_MAX_LOG_VALUE_LENGTH } = {}
) {
  const normalized = replaceUnsafeLogCharacters(value)
    .replace(/\s+/gu, ' ')
    .trim();
  const safeFallback = replaceUnsafeLogCharacters(fallback || 'unknown')
    .replace(/\s+/gu, ' ')
    .trim() || 'unknown';
  const boundedLength = Number.isSafeInteger(maxLength) && maxLength > 1
    ? maxLength
    : DEFAULT_MAX_LOG_VALUE_LENGTH;
  const characters = Array.from(normalized || safeFallback);

  if (characters.length <= boundedLength) {
    return characters.join('');
  }
  return `${characters.slice(0, boundedLength - 1).join('')}…`;
}

function formatScrapeYardId(yardId) {
  if (yardId === null || yardId === undefined || String(yardId).trim() === '') {
    return 'ALL';
  }
  const normalizedYardId = normalizeYardId(yardId);
  return normalizedYardId === null ? 'invalid' : String(normalizedYardId);
}

function formatScrapeRowCount(rowCount) {
  const numericCount = Number(rowCount);
  return Number.isSafeInteger(numericCount) && numericCount >= 0
    ? String(numericCount)
    : 'unknown';
}

function logScrapeRequest(options, logger = console) {
  const isFullScrape =
    String(options?.make || '').toUpperCase() === 'ANY' &&
    String(options?.model || '').toUpperCase() === 'ANY';
  logger.log(
    `[scrape] Start yard=${formatScrapeYardId(options?.yardId)} scope=${isFullScrape ? 'full' : 'filtered'}`
  );
}

function logScrapeYardResult(yardId, rowCount, logger = console) {
  logger.log(
    `[scrape] Complete yard=${formatScrapeYardId(yardId)} rows=${formatScrapeRowCount(rowCount)}`
  );
}

module.exports = {
  formatScrapeLogValue,
  formatScrapeYardId,
  logScrapeRequest,
  logScrapeYardResult,
};
