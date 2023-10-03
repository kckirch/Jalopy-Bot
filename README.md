# Jalopy Discord Bot

Jalopy is a Discord bot designed to automate the process of searching for specific car parts across multiple scrapyards.

## Features

- **Real-time Interaction**: Engage with users in real-time to fetch their requirements.
- **Concurrent Search**: Manages multiple search requests simultaneously using a task queue.
- **Comprehensive Results**: Provides detailed search results in a tabular format.

## Technologies Used

- **Python**: Core programming language used for the bot.
- **Selenium**: Used for web scraping to fetch data from scrapyards.
- **SQLite**: Lightweight database to store and manage data.
- **Discord.py**: Python library to interact with the Discord API.

## Getting Started

### Prerequisites

- Python (version 3.8 or higher recommended)
- SQLite
- Selenium

### Installation

1. Clone the repository:
`git glone https://github.com/kckirch/Jalopy-Bot`

2. Install the required Python packages:
`pip install -r requirements.txt`

3. Set up your `.env` file with your Discord bot token and other necessary configurations.

### Usage

1. Start the bot:
`python main.py`

2. Invite the bot to your Discord server and interact using the predefined commands.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT](https://choosealicense.com/licenses/mit/)

## Disclaimer

This bot was developed for educational purposes only. Before using it, always ensure that you have permission to scrape or interact with the target website and that you respect the robots.txt file of the site. 
Misusing the bot can lead to legal consequences or being banned from the website. Use at your own risk.
