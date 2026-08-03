const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { resolveChromedriverPath } = require('./chromedriverResolver');

const CHROME_ARGUMENTS = [
  '--ignore-certificate-errors',
  '--disable-gpu',
  '--headless',
  'excludeSwitches=enable-logging',
  '--allow-running-insecure-content',
];

async function createSeleniumDriver(dependencies = {}) {
  const BuilderClass = dependencies.Builder || Builder;
  const chromeApi = dependencies.chrome || chrome;
  const resolveDriverPath =
    dependencies.resolveChromedriverPath || resolveChromedriverPath;
  const logger = dependencies.logger || console;

  const chromeOptions = new chromeApi.Options();
  chromeOptions.addArguments(...CHROME_ARGUMENTS);

  let builder = new BuilderClass()
    .forBrowser('chrome')
    .setChromeOptions(chromeOptions);
  const chromedriverPath = resolveDriverPath();

  if (chromedriverPath) {
    logger.log('Using configured Chromedriver.');
    const serviceBuilder = new chromeApi.ServiceBuilder(chromedriverPath);
    builder = builder.setChromeService(serviceBuilder);
  } else {
    logger.warn(
      'Chromedriver not found in known locations. Attempting to use Selenium default driver resolution.'
    );
  }

  return builder.build();
}

module.exports = {
  CHROME_ARGUMENTS,
  createSeleniumDriver,
};
