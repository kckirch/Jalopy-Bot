# JalopyBot

[![CI](https://github.com/kckirch/Jalopy-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/kckirch/Jalopy-Bot/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

JalopyBot is a Discord bot that provides timely notifications for your favorite vehicles at Jalopy Jungle Junkyard in Boise, Idaho. This bot empowers users with custom notifications, advanced search capabilities, and a streamlined user experience to help you stay updated with the latest additions to the junkyard.
To use the bot without running it yourself, visit [JalopyBot.com](https://jalopybot.com).

## Features

- **Real-time Daily Notifications**: Get instant alerts when new vehicles are added to the inventory.
- **Search Across Multiple Yards**: Comprehensive search results across all Jalopy Jungle yards at once.
- **Custom Model Year Ranges**: Filter vehicles by specific model year ranges to find exactly what you need.
- **Alias Naming Conventions**: Simplify your search with alias naming conventions.

## Why JalopyBot?

Frustrated with not knowing when a vehicle was added to the lot? The Jalopy Jungle website doesn’t show this information, but JalopyBot does. Get daily notifications when new cars are added, and tailor your search preferences to receive updates on the vehicles you’re most interested in. Built to help you stay ahead, JalopyBot is your go-to solution for efficient and timely junkyard searches.

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

3. Configure scraper engine mode with `SCRAPER_ENGINE`:
    - `http` (recommended): Uses HTTP + HTML parsing, no chromedriver required.
    - `selenium`: Uses Selenium with `CHROMEDRIVER_PATH`, a system driver, or Selenium Manager.
    - `auto` (default): Uses Selenium when an external chromedriver executable is available, otherwise HTTP.

    Chromedriver is not bundled. If you use Selenium, keep the browser driver outside this repository and set `CHROMEDRIVER_PATH` when automatic resolution is unavailable.

4. Create the ignored runtime environment file from the checked-in example:
    ```bash
    cp .env.example src/.env
    ```

    At minimum, configure the following values in `src/.env`:
    ```env
    TOKEN=your_discord_token
    GUILD_ID=your_guild_id
    CLIENT_ID=your_client_id
    VEHICLE_DB_PATH=/absolute/path/to/vehicleInventory.db
    SCRAPER_ENGINE=http
    SCHEDULER_TIMEZONE=Etc/GMT+7
    SCRAPE_LOG_MODE=summary
    ```

    Keep the production database outside the Git checkout and set `VEHICLE_DB_PATH` to its absolute path. See [`.env.example`](.env.example) for every supported option.

    `SCHEDULER_TIMEZONE` defaults to `Etc/GMT+7` (fixed MST). Daily jobs run at `05:00` (scrape) and `05:45` (saved-search notifications) in that timezone.

5. Register slash commands (run on deploys or when command definitions change):
    ```bash
    npm run register:commands
    ```

6. Start the bot:
    ```bash
    npm start
    ```

    Or use one command for production cutovers:
    ```bash
    npm run start:prod
    ```

## Usage

### Discord Commands

- **/scrape**: Initiate a web scrape for vehicle data. Options:
  - `location`: The yard location to search (e.g., BOISE, GARDENCITY, ALL).
  - `make`: The make of the vehicle (e.g., TOYOTA, FORD).
  - `model`: The model of the vehicle (e.g., CAMRY, F-150).

- **/savedsearch**: Manage your saved search preferences.
  - `add`: Add a new search preference.
  - `list`: List all your saved search preferences.
  - `remove`: Remove a saved search preference.

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

- **saved_searches**:
  - `user_id`: Unique identifier for the user.
  - `discord_username`: Discord username of the user.
  - `yard_id`: Identifier for the yard.
  - `yard_name`: Name of the yard.
  - `make`: Make of the vehicle.
  - `model`: Model of the vehicle.
  - `year_range`: Year range for the search.
  - `status`: Status of the vehicle (e.g., NEW, ACTIVE, INACTIVE).
  - `frequency`: Frequency of notifications.
  - `last_notified_date`: Date when the user was last notified.
  - `creation_date`: Date when the search was created.
  - `update_date`: Date when the search was last updated.
  - `notes`: Additional notes about the search.

## Development

### Prerequisites

- Node.js v20.18.1 through v24 (Node.js 24 LTS recommended)
- npm
- SQLite (for local development)

### Running Locally

1. Ensure you have the latest version of Node.js installed.
2. Clone the repository and navigate to the project directory.
3. Install the dependencies:
    ```bash
    npm ci
    ```
4. Set `SCRAPER_ENGINE` in your env:
   - `SCRAPER_ENGINE=http` for chromedriver-free scraping.
   - `SCRAPER_ENGINE=selenium` to use an external driver or Selenium Manager.
   - `SCRAPER_ENGINE=auto` to choose Selenium only when an external chromedriver executable is available.
   Set `SCRAPE_LOG_MODE=summary` for concise yard/make logs, or `SCRAPE_LOG_MODE=full` for per-vehicle insert/update logs.
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

On Node.js 22.8 or newer, enforce the current regression floor of 82% line, 68% branch, and 90% function coverage:
```bash
npm run test:coverage
```

Lint all source, test, script, and configuration JavaScript:

```bash
npm run lint
```

Run fixture-based parser replay tests (no live network calls):
```bash
npm test -- test/httpInventoryReplayFixtures.test.js
```

Run the live scrape smoke test against an isolated temporary DB:
```bash
npm run smoke:live -- --engine http
```

Pull requests run the full suite on Node.js 20, 22, and 24, plus coverage,
lint, production dependency audit, and full-history secret scan gates. Keep
branches short-lived and merge them only after CI passes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete development and pull
request workflow. Report vulnerabilities or exposed private data through the
private process in [SECURITY.md](SECURITY.md), never in a public issue.

## Inventory API (Pi)

You can expose read-only inventory data directly from the bot host (Pi) so external apps do not need to download `vehicleInventory.db` from GitHub.

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
