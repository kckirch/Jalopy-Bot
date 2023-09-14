import sqlite3

DB_PATH = 'database/jalopy_database.db'

def initialize_db():
   

    connection = sqlite3.connect(DB_PATH)
    cursor = connection.cursor()

    # Creating the table (as an example)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS cars(
        id INTEGER PRIMARY KEY,
        yard_id INTEGER,
        car_make TEXT,
        car_model TEXT,
        year INTEGER,
        row_number INTEGER,
        date_first_seen TEXT NOT NULL,
        UNIQUE(yard_id, car_make, car_model, year, row_number)
    )
    ''')

    connection.commit()
    connection.close()

def get_connection():
    return sqlite3.connect(DB_PATH)
