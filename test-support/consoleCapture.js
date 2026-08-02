function formatConsoleValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function captureConsole(run) {
  const methods = ['debug', 'error', 'info', 'log', 'warn'];
  const originals = new Map();
  const calls = [];

  for (const method of methods) {
    originals.set(method, console[method]);
    console[method] = (...args) => {
      calls.push({
        method,
        args,
        text: args.map(formatConsoleValue).join(' '),
      });
    };
  }

  try {
    await run();
  } finally {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  }

  return calls;
}

function joinedConsoleText(calls) {
  return calls.map((call) => call.text).join('\n');
}

module.exports = {
  captureConsole,
  joinedConsoleText,
};
