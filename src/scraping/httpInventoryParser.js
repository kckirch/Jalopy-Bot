function normalizeSearchValue(value) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized) return '';
  return normalized.toUpperCase() === 'ANY' ? '' : normalized;
}

function findInventoryForm($) {
  const inventoryForm = $('#searchinventory').first();
  return inventoryForm.length ? inventoryForm : $('form').first();
}

function resolveFormActionUrl(form, inventoryUrl) {
  const inventoryBaseUrl = new URL(inventoryUrl);
  if (inventoryBaseUrl.protocol !== 'http:' && inventoryBaseUrl.protocol !== 'https:') {
    throw new Error('Inventory URL must use HTTP or HTTPS.');
  }

  const action = String(form.attr('action') || '').trim();
  const actionUrl = new URL(action || inventoryUrl, inventoryBaseUrl);
  if (
    actionUrl.origin !== inventoryBaseUrl.origin ||
    actionUrl.username ||
    actionUrl.password
  ) {
    throw new Error('Inventory search form action must stay on the configured origin.');
  }
  return actionUrl.toString();
}

function extractHiddenInputs($, form) {
  const hiddenInputs = {};
  form.find('input[type="hidden"][name]').each((index, input) => {
    const name = String($(input).attr('name') || '').trim();
    if (name) {
      hiddenInputs[name] = String($(input).attr('value') || '');
    }
  });
  return hiddenInputs;
}

function resolveFieldName($, form, selector, fallbackName) {
  const formField = form.find(selector).first();
  const field = formField.length ? formField : $(selector).first();
  if (!field.length) return fallbackName;
  return (
    String(field.attr('name') || field.attr('id') || fallbackName).trim() ||
    fallbackName
  );
}

function resolveFormMeta($, inventoryUrl, previousMeta = null) {
  const form = findInventoryForm($);

  if (!form.length) {
    if (previousMeta) return previousMeta;
    throw new Error('Could not locate inventory search form in HTML response.');
  }

  const method = String(form.attr('method') || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    throw new Error('Inventory search form uses an unsupported method.');
  }

  return {
    method,
    actionUrl: resolveFormActionUrl(form, inventoryUrl),
    hiddenInputs: extractHiddenInputs($, form),
    fields: {
      yard: resolveFieldName($, form, '#yard-id', 'yard-id'),
      make: resolveFieldName($, form, '#car-make', 'car-make'),
      model: resolveFieldName($, form, '#car-model', 'car-model'),
    },
  };
}

function extractOptionValues($, selector) {
  const values = [];
  $(selector).first().find('option').each((index, option) => {
    const value = String($(option).attr('value') || '').trim();
    if (!value) return;
    values.push(value);
  });
  return values;
}

function extractResultRows($) {
  const rows = [];
  const rowSelector = '.table-responsive table tbody tr, table tbody tr';

  $(rowSelector).each((index, row) => {
    const columns = $(row).find('td');
    if (columns.length < 4) return;

    const year = Number.parseInt($(columns[0]).text().trim(), 10);
    const make = $(columns[1]).text().trim();
    const model = $(columns[2]).text().trim();
    const rowNumber = Number.parseInt($(columns[3]).text().trim(), 10);

    if (Number.isNaN(year) || Number.isNaN(rowNumber) || !make || !model) {
      return;
    }
    rows.push({ year, make, model, rowNumber });
  });

  return rows;
}

function buildSubmissionPayload(
  formMeta,
  { yardId, make, model, hasMultipleLocations }
) {
  const payload = { ...formMeta.hiddenInputs };
  const normalizedMake = normalizeSearchValue(make);
  const normalizedModel = normalizeSearchValue(model);

  if (hasMultipleLocations && yardId != null) {
    payload[formMeta.fields.yard] = String(yardId);
  }
  if (make != null) {
    payload[formMeta.fields.make] = normalizedMake;
  }
  if (model != null) {
    payload[formMeta.fields.model] = normalizedModel;
  }
  return payload;
}

function uniqueNonEmptyStrings(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = String(value == null ? '' : value).trim();
    if (!normalized) continue;
    const key = normalized.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

module.exports = {
  buildSubmissionPayload,
  extractOptionValues,
  extractResultRows,
  normalizeSearchValue,
  resolveFormMeta,
  uniqueNonEmptyStrings,
};
