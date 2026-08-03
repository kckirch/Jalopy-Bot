function buildInventoryHtml({
  yardOptions = ['1020'],
  makeOptions = [],
  modelOptions = [],
  rows = [],
} = {}) {
  const yardOptionHtml = [
    '<option value="">Select Location</option>',
    ...yardOptions.map((yardId) => `<option value="${yardId}">${yardId}</option>`),
  ].join('');
  const makeOptionHtml = [
    '<option value="">Select Make</option>',
    ...makeOptions.map((value) => `<option value="${value}">${value}</option>`),
  ].join('');
  const modelOptionHtml = [
    '<option value="">Select Model</option>',
    ...modelOptions.map((value) => `<option value="${value}">${value}</option>`),
  ].join('');
  const rowHtml = rows
    .map(
      (row) => `
        <tr>
          <td>${row.year}</td>
          <td>${row.make}</td>
          <td>${row.model}</td>
          <td>${row.rowNumber}</td>
        </tr>
      `
    )
    .join('');

  return `
    <html>
      <body>
        <form action="/" enctype="multipart/form-data" id="searchinventory" method="post">
          <select class="form-control" id="yard-id" name="YardId">${yardOptionHtml}</select>
          <select class="form-control" id="car-make" name="VehicleMake">${makeOptionHtml}</select>
          <select class="form-control" id="car-model" name="VehicleModel">${modelOptionHtml}</select>
          <input type="submit" value="SEARCH" class="btn btn-primary">
        </form>
        <div class="table-responsive">
          <table class="table">
            <tbody>
              <tr>
                <th>YEAR</th>
                <th>MAKE</th>
                <th>MODEL</th>
                <th>ROW</th>
              </tr>
              ${rowHtml}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function parsePayload(config) {
  if (typeof config.data === 'string') {
    return Object.fromEntries(new URLSearchParams(config.data).entries());
  }
  if (config.params && typeof config.params === 'object') {
    return config.params;
  }
  return {};
}

function ok(data) {
  return { status: 200, headers: {}, data };
}

function inventoryPage(options) {
  return ok(buildInventoryHtml(options));
}

function createRouteHttpClient(routes) {
  return {
    async request(config) {
      const method = String(config.method || 'GET').toUpperCase();
      const pathname = new URL(config.url).pathname;
      const key = `${method} ${pathname}`;
      const route = routes[key];
      if (!route) {
        throw new Error(`Unexpected request: ${key}`);
      }

      const request = { config, method, pathname, payload: parsePayload(config) };
      return typeof route === 'function' ? route(request) : route;
    },
  };
}

function createScrapeConfig(overrides = {}) {
  return {
    inventoryUrl: 'https://inventory.pickapartjalopyjungle.com/',
    hasMultipleLocations: true,
    yardId: '1020',
    make: 'ANY',
    model: 'ANY',
    sessionID: '20260224',
    shouldMarkInactive: true,
    ...overrides,
  };
}

module.exports = {
  createRouteHttpClient,
  createScrapeConfig,
  inventoryPage,
  ok,
};
