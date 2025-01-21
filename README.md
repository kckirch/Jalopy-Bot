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

3. Ensure you have [Chromedriver](https://sites.google.com/chromium.org/driver/) installed and set up in your system's PATH. You can download Chromedriver from [here](https://sites.google.com/chromium.org/driver/downloads).

4. Configure environment variables. Create a `.env` file in the root directory with the following variables:
    ```env
    TOKEN=your_discord_token
    GUILD_ID=your_guild_id
    CLIENT_ID=your_client_id
    ```

5. Start the bot:
    ```bash
    npm start
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
4. Ensure you have [Chromedriver](https://sites.google.com/chromium.org/driver/) installed and set up in your system's PATH.
5. Start the bot:
    ```bash
    npm start
    ```

### Testing

To run the tests, use:
```bash
npm test
