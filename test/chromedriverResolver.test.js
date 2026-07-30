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

test('resolveChromedriverPath falls back to an executable chromedriver on PATH', async () => {
  const previous = process.env.CHROMEDRIVER_PATH;
  const previousPath = process.env.PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jalopy-chromedriver-resolver-'));
  const configuredDriverPath = path.join(tempDir, 'configured-chromedriver');
  const pathDriverPath = path.join(tempDir, 'chromedriver');
  fs.writeFileSync(configuredDriverPath, '#!/bin/sh\necho configured-driver\n', { mode: 0o644 });
  fs.writeFileSync(pathDriverPath, '#!/bin/sh\necho path-driver\n', { mode: 0o755 });

  try {
    process.env.CHROMEDRIVER_PATH = configuredDriverPath;
    process.env.PATH = `${tempDir}${path.delimiter}${previousPath || ''}`;
    delete require.cache[resolverPath];
    const { resolveChromedriverPath } = require(resolverPath);
    const resolved = resolveChromedriverPath();
    assert.equal(resolved, path.resolve(pathDriverPath));
  } finally {
    restoreEnv(previous);
    if (typeof previousPath === 'string') {
      process.env.PATH = previousPath;
    } else {
      delete process.env.PATH;
    }
    delete require.cache[resolverPath];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
