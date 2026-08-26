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

function parsePayload(url, options) {
  if (String(options.method || 'GET').toUpperCase() === 'GET') {
    return Object.fromEntries(url.searchParams.entries());
  }
  return Object.fromEntries(new URLSearchParams(options.body || '').entries());
}

function ok(data) {
  return new Response(
    typeof data === 'string' ? data : JSON.stringify(data),
    { status: 200 }
  );
}

function inventoryPage(options) {
  return ok(buildInventoryHtml(options));
}

function createRouteFetch(routes) {
  return async (input, options = {}) => {
    const url = new URL(input);
    const method = String(options.method || 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected request: ${key}`);

    const request = {
      method,
      pathname: url.pathname,
      payload: parsePayload(url, options),
    };
    const response = typeof route === 'function' ? route(request) : route;
    return response.clone();
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
  createRouteFetch,
  createScrapeConfig,
  inventoryPage,
  ok,
};
