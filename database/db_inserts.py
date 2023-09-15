from datetime import datetime
import sqlite3
from .db_setup import get_connection

def car_entry_exists(yard_id, car_make, car_model, year, row_number):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("""
        SELECT date_first_seen 
        FROM cars 
        WHERE yard_id = ? 
        AND car_make = ? 
        AND car_model = ? 
        AND year = ? 
        AND row_number = ?
    """, (yard_id, car_make, car_model, year, row_number))

    result = cursor.fetchone()
    connection.close()

    # Return None if the entry doesn't exist
    if result is None:
        return None
    # If the entry does exist, return the date_first_seen
    else:
        return result[0]



def insert_car_entry(yard_id, car_make, car_model, year, row_number):
    connection = get_connection()
    cursor = connection.cursor()

    # Get the current date
    current_date = datetime.now().strftime('%Y-%m-%d')  # This will give a string in the format 'YYYY-MM-DD'

    try:
        cursor.execute('''
        INSERT INTO cars (yard_id, car_make, car_model, year, row_number, date_first_seen)
        VALUES (?, ?, ?, ?, ?, ?)
        ''', (yard_id, car_make, car_model, year, row_number, current_date))

        connection.commit()
    except sqlite3.IntegrityError:
        # This will catch any attempt to insert a duplicate entry, because of the UNIQUE constraint we set
        pass
    finally:
        connection.close()


def fetch_car_date_first_seen(yard_id, car_make, car_model, year, row_number):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute("SELECT date_first_seen FROM cars WHERE yard_id = ? AND car_make = ? AND car_model = ? AND year = ? AND row_number = ?", (yard_id, car_make, car_model, year, row_number))
    date_first_seen = cursor.fetchone()[0]
    connection.close()
    return date_first_seen
