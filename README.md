# JalopyBot

JalopyBot is a Discord bot that provides timely notifications for your favorite vehicles at Jalopy Jungle Junkyard in Boise, Idaho. This bot empowers users with custom notifications, advanced search capabilities, and a streamlined user experience to help you stay updated with the latest additions to the junkyard.
Want to use the tool without running it, join the Discord Group, https://JalopyBot.com

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
    npm install
    ```

3. Configure scraper engine mode with `SCRAPER_ENGINE`:
    - `http` (recommended): Uses HTTP + HTML parsing, no chromedriver required.
    - `selenium`: Uses Selenium + Chrome/Chromedriver.
    - `auto` (default): Uses Selenium when chromedriver is available, otherwise HTTP.

4. Configure environment variables. Create a `.env` file in the root directory with the following variables:
    ```env
    TOKEN=your_discord_token
    GUILD_ID=your_guild_id
    CLIENT_ID=your_client_id
    SCRAPER_ENGINE=http
    SCHEDULER_TIMEZONE=Etc/GMT+7
    SCRAPE_LOG_MODE=summary
    ```

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

- Node.js v20.10.0 or later
- npm
- SQLite (for local development)

### Running Locally

1. Ensure you have the latest version of Node.js installed.
2. Clone the repository and navigate to the project directory.
3. Install the dependencies:
    ```bash
    npm install
    ```
4. Set `SCRAPER_ENGINE` in your env:
   - `SCRAPER_ENGINE=http` for chromedriver-free scraping.
   - `SCRAPER_ENGINE=selenium` to keep the existing Selenium flow.
   - `SCRAPER_ENGINE=auto` to choose at runtime based on chromedriver availability.
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

Run fixture-based parser replay tests (no live network calls):
```bash
npm test -- test/httpInventoryReplayFixtures.test.js
```

Run the live scrape smoke test against an isolated temporary DB:
```bash
npm run smoke:live -- --engine http
```

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
- `GET /api/vehicle-db` (raw SQLite snapshot with ETag/Last-Modified caching)

Supported query params:
- `yard` (single or comma-separated)
- `make`
- `model`
- `status` (`ACTIVE`, `NEW`, `INACTIVE`)
- `year`
- `yearStart`, `yearEnd`
- `limit` (max 10000)
