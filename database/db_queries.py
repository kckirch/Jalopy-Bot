import sqlite3


def get_new_entries(yard_id, car_make, car_model, last_checked_year):
    conn = sqlite3.connect('jalopy_bot.db')
    cursor = conn.cursor()

    cursor.execute("SELECT year, row_number FROM cars WHERE yard_id = ? AND car_make = ? AND car_model = ? AND year > ?",
                   (yard_id, car_make, car_model, last_checked_year))
    
    results = cursor.fetchall()
    conn.close()
    
    return results
