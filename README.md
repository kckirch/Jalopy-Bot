# JalopyBot

[![CI](https://github.com/kckirch/Jalopy-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/kckirch/Jalopy-Bot/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

JalopyBot is an open-source Discord bot and read-only inventory API for Idaho
salvage yards. It tracks when vehicles first appear, supports saved-search
alerts, and powers [JalopyBot.com](https://jalopybot.com) without publishing
Discord identities or saved searches.

The current yard set includes Jalopy Jungle locations in Boise, Caldwell,
Nampa, Garden City, and Twin Falls, plus Trusty Pick A Part.

## Features

- **Daily Saved-Search Alerts**: Receive scheduled Discord notifications for matching inventory.
- **Six-Yard Search**: Search one yard, the Treasure Valley group, or every supported yard.
- **First-Seen Tracking**: Distinguish newly discovered, active, and inactive inventory.
- **Flexible Filters**: Search by make, model aliases, year lists or ranges, and status.
- **Direct HTTP Scraping**: Collect inventory without a browser or driver.
- **Privacy-Preserving API**: Serve a vehicles-only SQLite snapshot to the public website.

## Why JalopyBot?

Source inventory pages do not consistently expose when a vehicle first
appeared. JalopyBot records that history in a private runtime database, uses it
for Discord search and alerts, and creates a separate vehicles-only snapshot
for public API consumers.

## Project layout

- `src/bot`: Discord startup, commands, handlers, and permissions.
- `src/scraping`: HTTP inventory collector and parsing helpers.
- `src/database`: Runtime schema, queries, and saved-search persistence.
- `src/notifications`: Scheduled scrapes and Discord alert processing.
- `src/api`: Read-only JSON and vehicles-only SQLite endpoints.
- `src/testing`: Opt-in live smoke tools.
- `test`: Isolated unit, integration, and recorded-fixture tests.

## Installation

1. Clone the repository:
    ```bash
    git clone https://github.com/kckirch/Jalopy-Bot.git
    cd Jalopy-Bot
    ```

2. Install the required dependencies:
    ```bash
    npm ci
    ```

3. Create the ignored runtime environment file from the checked-in example:
    ```bash
    cp .env.example src/.env
    ```

    At minimum, configure the following values in `src/.env`:
    ```env
    TOKEN=your_discord_token
    GUILD_ID=your_guild_id
    CLIENT_ID=your_client_id
    NEW_VEHICLES_CHANNEL_ID=your_new_vehicles_channel_id
    VEHICLE_DB_PATH=/absolute/path/to/vehicleInventory.db
    SCHEDULER_TIMEZONE=Etc/GMT+7
    SCRAPE_LOG_MODE=summary
    ```

    Keep the production database outside the Git checkout and set `VEHICLE_DB_PATH` to its absolute path. See [`.env.example`](.env.example) for every supported option.

    `SCHEDULER_TIMEZONE` defaults to `Etc/GMT+7` (fixed MST). Daily jobs run at `05:00` (scrape) and `05:45` (saved-search notifications) in that timezone. Startup and hourly `:30` recovery checks catch up missed work. A durable `scheduled_job_runs` ledger prevents a completed session from being delivered twice, while deterministic Discord embed footers make a partially delivered daily channel post safe to retry. Successful zero-result days publish a heartbeat to the configured channel.

4. Register slash commands (run on deploys or when command definitions change):
    ```bash
    npm run register:commands
    ```

5. Start the bot:
    ```bash
    npm start
    ```

    Or use one command for production cutovers:
    ```bash
    npm run start:prod
    ```

### Run as user services on Linux

The checked-in systemd user units keep both long-running processes supervised
without requiring an open shell session. They assume the checkout is at
`~/Jalopy-Bot`; change `WorkingDirectory` in both copied units when deploying
somewhere else.

```bash
npm ci --omit=dev
chmod 600 src/.env
mkdir -p ~/.config/systemd/user
cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now jalopy-bot.service jalopy-inventory-api.service
```

If user services do not survive logout or reboot on the host, ask its
administrator to enable lingering for the deployment account. Check both
processes after a deploy:

```bash
systemctl --user status jalopy-bot.service jalopy-inventory-api.service
curl --fail http://127.0.0.1:8787/health
```

Run `npm run register:commands` separately whenever the Discord command
definitions change. Keep `src/.env` and the runtime database out of the Git
checkout as described above.

## Usage

### Discord Commands

- **`/commands`**: Show the in-Discord command guide.
- **`/search`**: Search by location, make, model, year, and status. Result
  controls provide pagination, location switching, **Edit Search**, **Save Alert**,
  and **Manage Alerts**. Location defaults to All. Make aliases such as `VW` and
  model spellings such as `4runner` / `4 runner` work consistently. With BMW
  selected, `3series` / `3 SERIES` includes the supported 3 Series variants.
  Autocomplete includes historical models. Invalid makes and no-result searches
  offer close-spelling choices; **Edit Search** opens a prefilled dialog. Suggestions
  never silently change your filters. Known models with no matches get guidance
  to relax years or location instead of being presented as spelling errors.
- **`/savedsearch`**: Privately view, run, pause/resume, or remove your saved
  alerts. **Test DMs** sends one test message only when clicked; it does not
  change alert settings. Removal requires confirmation. All (or no location)
  shows every alert; a yard or yard group shows alerts covering any of its yards.

To create an alert, run `/search make:BMW model:3series year:2006-2011`, review
the results and filters, then select **Save Alert**. Saving also works with zero
matches. New commands reject invalid years; use a four-digit year, an ascending
range, or comma-separated years/ranges. Existing saved filters are not migrated.

Alerts run on the daily schedule, not immediately after saving. The default
Active filter sends **all matching available vehicles**, including new arrivals;
it is not a new-arrivals-only subscription. Select status New for vehicles marked
NEW by the scrape lifecycle. DMs are sent when matches exist and delivery is
allowed. Pausing keeps the filters; resuming re-enables daily delivery. Test DMs
checks current DM permissions, not future delivery or scheduler health.

Search controls expire after two minutes and can only be used by the person
who ran the command. Each search message has its own independent session.
Expiration does not pause or delete an alert; rerun `/search` or `/savedsearch`
to reopen controls.
Edit dialogs wait up to 90 seconds for a submission. If the search expires first,
submitting within that window shows a private expiry notice and changes nothing.

### Guided families and generation shortcuts

After choosing a make, the response's **Search a family or generation** menu
offers the website's explicit model families, even when the original search has
results. For example, a BMW `328I` search can become **3 SERIES**, or a Volkswagen
`GOLF` search can include the **GOLF / GTI FAMILY**. Family selection keeps the
current years, location, and status. These are browsing groups, not assurances
of shared chassis or interchangeable parts.

BMW also has two **approximate US model-year shortcuts**: **E9x 3 Series
(2006–2013)** and **F3x 3 Series (2012–2019)**. Typing `E90`, `E9x`, `F30`, or
`F3x` puts the relevant choice first; it is applied only after you select it.
Generation selection replaces both the model and displayed year range, keeping
location and status. Inventory does not record chassis/VIN/body style, so
transition-year cars can overlap generations. F3x excludes M3/F80, M4, and
4 Series; E9x includes M3. Use the ordinary model family to search outside a
generation's window. A modal-edited year range further narrows that window.

Year-window references: BMW's [2006 sedan/wagon press kit](https://www.press.bmwgroup.com/usa/article/detail/T0019100EN_US/press-kit%3A-2006-bmw-3-series-sedans-and-sports-wagon?language=en_US),
[2012 3 Series launch](https://www.press.bmwgroup.com/usa/article/detail/T0124925EN_US/bmw-at-the-82nd-geneva-motor-show-2012?language=en_US),
and [2014 model-year changes](https://www.press.bmwgroup.com/usa/article/detail/T0151024EN_US/2014-model-year-changes?language=en_US);
the [2019 US model list](https://www.nhtsa.gov/sites/nhtsa.gov/files/documents/2019_aala_alpha_06042019.pdf)
includes the outgoing wagon/GT alongside the [new 2019 sedan](https://www.press.bmwgroup.com/usa/article/detail/T0285572EN_US/the-all-new-2019-bmw-3-series).

**Save Alert** stores exactly the successfully displayed filters. Explicit groups
use namespaced values such as `FAMILY: 3 SERIES` or `GENERATION: E9X (APPROX)` in
the existing model field; daily notifications and **Run Search** resolve the
same catalog. No schema migration or changes to existing saved alerts are
required. The catalog lives in `src/database/vehicleSearchGroups.js`; tests pin
the website family rules and generation boundaries. No website deployment or
slash-command registration change is required for these response controls.

### Maintenance commands

The following commands require elevated Discord permissions:

- **`/scrape`**: Run an inventory scrape for a location and optional make/model.
- **`/runtestscheduler`**: Recover the missed morning scrape and alert workflow.

### Database Structure

The database contains the following tables:

- **vehicles**:
  - `id`: Unique identifier for each vehicle.
  - `yard_id`: Identifier for the yard.
  - `yard_name`: Name of the yard.
  - `vehicle_make`: Make of the vehicle.
  - `vehicle_model`: Model of the vehicle.
  - `vehicle_year`: Year of the vehicle.
  - `row_number`: Row number where the vehicle is located.
  - `first_seen`: Date when the vehicle was first seen.
  - `last_seen`: Date when the vehicle was last seen.
  - `vehicle_status`: Status of the vehicle (e.g., NEW, ACTIVE, INACTIVE).
  - `date_added`: Date when the vehicle was added to the database.
  - `last_updated`: Date when the vehicle data was last updated.
  - `notes`: Additional notes about the vehicle.
  - `session_id`: Scrape session that most recently observed the vehicle.

- **saved_searches**:
  - `id`: Unique identifier for the saved search.
  - `user_id`: Unique identifier for the user.
  - `username`: Discord username captured with the search.
  - `yard_id`: Identifier for the yard.
  - `yard_name`: Name of the yard.
  - `make`: Make of the vehicle.
  - `model`: Model of the vehicle.
  - `year_range`: Year range for the search.
  - `status`: Status of the vehicle (e.g., NEW, ACTIVE, INACTIVE).
  - `frequency`: Frequency of notifications.
  - `last_notified`: Date when the user was last notified.
  - `create_date`: Date when the search was created.
  - `update_date`: Date when the search was last changed.
  - `alert_on_new`: Whether the search is configured to alert for new rows.
  - `priority`: Optional search priority.
  - `notes`: Additional notes about the search.

The runtime database is private and must live outside the Git checkout. Public
API downloads are generated from a separate snapshot containing only the
`vehicles` table.

## Development

### Prerequisites

- Node.js 20.19+, 22.13+, or 24.x (Node.js 24 LTS recommended)
- npm
- SQLite (for local development)

### Running Locally

1. Ensure you have the latest version of Node.js installed.
2. Clone the repository and navigate to the project directory.
3. Install the dependencies:
    ```bash
    npm ci
    ```
4. Set `SCRAPE_LOG_MODE=summary` for concise yard/make logs, or `SCRAPE_LOG_MODE=full` for per-vehicle insert/update logs.
5. Register slash commands when needed:
    ```bash
    npm run register:commands
    ```
6. Start the bot:
    ```bash
    npm start
    ```

### Testing

To run the tests, use:
```bash
npm test
```

Each test run uses a temporary SQLite database and removes it afterward, so tests never open the configured production database.

On Node.js 22.13 or newer, enforce the current regression floor of 82% line, 68% branch, and 90% function coverage:
```bash
npm run test:coverage
```

Lint all source, test, script, and configuration JavaScript:

```bash
npm run lint
```

Check for unused files, dependencies, exports, and production-only dead code:

```bash
npm run check:dead-code
npm run check:dead-code:production
```

Run fixture-based parser replay tests (no live network calls):
```bash
npm test -- test/httpInventoryReplayFixtures.test.js
```

Run the live scrape smoke test against an isolated temporary DB:
```bash
npm run smoke:live -- --location boise
```

Pull requests run the full suite on Node.js 20, 22, and 24, plus coverage,
lint, production dependency audit, and full-history secret scan gates. Keep
branches short-lived and merge them only after CI passes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete development and pull
request workflow. Report vulnerabilities or exposed private data through the
private process in [SECURITY.md](SECURITY.md), never in a public issue.

## Inventory API

The bot host can expose read-only inventory data so external apps do not need
the private runtime database or a database file stored in GitHub.

### Start the API

```bash
npm run start:inventory-api
```

Default bind:
- `INVENTORY_API_HOST=0.0.0.0`
- `INVENTORY_API_PORT=8787`

Optional hardening:
- `INVENTORY_API_KEY=your-long-random-token` (required via `x-api-key` header)
- `INVENTORY_API_ALLOWED_ORIGINS=https://your-site.com,https://www.your-site.com`
- `INVENTORY_DB_CACHE_SECONDS=3600` (snapshot cache TTL sent to clients/CDN)

### Endpoints

- `GET /health`
- `GET /api/vehicles`
- `GET /api/vehicle-db` (vehicles-only SQLite snapshot with ETag/Last-Modified caching)

The downloadable snapshot deliberately contains only the `vehicles` table. Discord identities,
saved searches, and other private runtime state are never copied into the public file.

Supported query params:
- `yard` (single or comma-separated)
- `make`
- `model`
- `status` (`ACTIVE`, `NEW`, `INACTIVE`)
- `year`
- `yearStart`, `yearEnd`
- `limit` (max 10000)

## Community and license

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support guide](SUPPORT.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

JalopyBot is available under the [ISC License](LICENSE).
