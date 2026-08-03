const { By, until } = require('selenium-webdriver');

const SELECT_TIMEOUT_MS = 5000;
const RESULTS_TIMEOUT_MS = 10000;

async function setElementValue(driver, elementId, value) {
  await driver.wait(
    until.elementLocated(By.css(`#${elementId}`)),
    SELECT_TIMEOUT_MS
  );
  return driver.executeScript(
    'document.getElementById(arguments[0]).value = arguments[1];',
    elementId,
    value
  );
}

function submitInventoryForm(driver) {
  return driver.executeScript(
    "document.getElementById('searchinventory').submit();"
  );
}

function dispatchElementChange(driver, elementId) {
  return driver.executeScript(
    "document.getElementById(arguments[0]).dispatchEvent(new Event('change'));",
    elementId
  );
}

async function selectValueAndSubmit(driver, elementId, value) {
  await setElementValue(driver, elementId, value);
  await submitInventoryForm(driver);
}

async function forEachSelectOptionValue(driver, elementId, callback) {
  const selectSelector = `#${elementId}`;
  const optionsSelector = `${selectSelector} option`;
  await driver.wait(
    until.elementLocated(By.css(selectSelector)),
    SELECT_TIMEOUT_MS
  );

  let options = await driver.findElements(By.css(optionsSelector));
  for (let index = 0; index < options.length; index += 1) {
    await driver.wait(
      until.elementLocated(By.css(selectSelector)),
      SELECT_TIMEOUT_MS
    );
    options = await driver.findElements(By.css(optionsSelector));
    const value = await options[index]?.getAttribute('value');
    if (value) await callback(value);
  }
}

async function processInventoryRows(driver, processVehicle) {
  await driver.wait(
    until.elementLocated(By.css('.table-responsive table')),
    RESULTS_TIMEOUT_MS
  );
  const rows = await driver.findElements(
    By.css('.table-responsive table tbody tr')
  );
  let processedRows = 0;

  for (const row of rows) {
    const columns = await row.findElements(By.tagName('td'));
    if (columns.length < 4) continue;

    await processVehicle({
      year: Number.parseInt(await columns[0].getText(), 10),
      make: await columns[1].getText(),
      model: await columns[2].getText(),
      rowNumber: Number.parseInt(await columns[3].getText(), 10),
    });
    processedRows += 1;
  }

  return processedRows;
}

module.exports = {
  dispatchElementChange,
  forEachSelectOptionValue,
  processInventoryRows,
  selectValueAndSubmit,
  setElementValue,
  submitInventoryForm,
};
