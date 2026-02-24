const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const resolverPath = path.join(repoRoot, 'src/scraping/chromedriverResolver.js');

function restoreEnv(previous) {
  if (typeof previous === 'string') {
    process.env.CHROMEDRIVER_PATH = previous;
  } else {
    delete process.env.CHROMEDRIVER_PATH;
  }
}

test('resolveChromedriverPath prefers CHROMEDRIVER_PATH when it points to an existing executable file', async () => {
  const previous = process.env.CHROMEDRIVER_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-chromedriver-resolver-'));
  const fakeDriverPath = path.join(tempDir, 'chromedriver');
  fs.writeFileSync(fakeDriverPath, '#!/bin/sh\necho fake-driver\n', { mode: 0o755 });

  try {
    process.env.CHROMEDRIVER_PATH = fakeDriverPath;
    delete require.cache[resolverPath];
    const { resolveChromedriverPath } = require(resolverPath);
    const resolved = resolveChromedriverPath();
    assert.equal(resolved, path.resolve(fakeDriverPath));
  } finally {
    restoreEnv(previous);
    delete require.cache[resolverPath];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveChromedriverPath falls back to bundled chromedriver when CHROMEDRIVER_PATH is not executable', async () => {
  const previous = process.env.CHROMEDRIVER_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-chromedriver-resolver-'));
  const fakeDriverPath = path.join(tempDir, 'chromedriver');
  fs.writeFileSync(fakeDriverPath, '#!/bin/sh\necho fake-driver\n', { mode: 0o644 });

  let bundled;
  try {
    bundled = require('chromedriver');
  } catch (error) {
    bundled = null;
  }

  if (!bundled || !bundled.path) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    restoreEnv(previous);
    return test.skip('chromedriver package path unavailable in this environment');
  }

  try {
    process.env.CHROMEDRIVER_PATH = fakeDriverPath;
    delete require.cache[resolverPath];
    const { resolveChromedriverPath } = require(resolverPath);
    const resolved = resolveChromedriverPath();
    assert.equal(resolved, path.resolve(bundled.path));
  } finally {
    restoreEnv(previous);
    delete require.cache[resolverPath];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
