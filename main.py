import bot
from database.db_setup import initialize_db

# Initialize the database
initialize_db()

if __name__ == '__main__':
    bot.run_discord_bot()