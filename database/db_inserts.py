from datetime import datetime
import sqlite3
from .db_setup import get_connection

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
