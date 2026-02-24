const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function commandExists(command) {
  const lookupCommand = os.platform() === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookupCommand, [command], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }

  const firstLine = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return null;
  }

  return firstLine;
}

function getCandidatePaths() {
  const platform = os.platform();
  const candidates = [];

  if (process.env.CHROMEDRIVER_PATH) {
    candidates.push(process.env.CHROMEDRIVER_PATH);
  }

  try {
    // Prefer the project-local chromedriver dependency when available.
    // This avoids relying on machine-global installation paths.
    const bundledChromedriver = require('chromedriver');
    if (bundledChromedriver && bundledChromedriver.path) {
      candidates.push(bundledChromedriver.path);
    }
  } catch (error) {
    // Dependency is optional at runtime for some environments.
  }

  const fromPath = commandExists('chromedriver');
  if (fromPath) {
    candidates.push(fromPath);
  }

  if (platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/chromedriver');
    candidates.push('/usr/local/bin/chromedriver');
  } else if (platform === 'win32') {
    candidates.push('C:/Program Files/chromedriver-win64/chromedriver.exe');
    candidates.push('C:/Program Files/Google/Chrome/Application/chromedriver.exe');
  } else {
    candidates.push('/usr/local/bin/chromedriver');
    candidates.push('/usr/bin/chromedriver');
  }

  return candidates;
}

function isUsableExecutable(candidate) {
  if (!candidate) return false;
  const normalized = path.resolve(candidate);
  if (!fs.existsSync(normalized)) return false;

  // On Unix, ensure the file is executable. On Windows, existence is sufficient.
  if (os.platform() !== 'win32') {
    try {
      fs.accessSync(normalized, fs.constants.X_OK);
    } catch (error) {
      return false;
    }
  }

  return true;
}

function resolveChromedriverPath() {
  const candidates = getCandidatePaths();

  for (const candidate of candidates) {
    if (isUsableExecutable(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

module.exports = {
  resolveChromedriverPath,
};
