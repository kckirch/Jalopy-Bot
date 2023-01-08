import requests
import datetime

from selenium import webdriver
from bs4 import BeautifulSoup

current_time = datetime.datetime.now().strftime("%A, %b-%d, %I:%M %p")

def get_response(message: str) -> str:
    p_message = message.lower()

    if p_message == '!help':
        return '`Welcome to the Jalopy Jungle Bot \n \nI am being built to help notify users for new car inventory. \n`'

    if p_message == '!s':
        # Set up the web driver
        driver = webdriver.Chrome()

        # Navigate to the website
        driver.get("http://inventory.pickapartjalopyjungle.com/")

        # Execute the JavaScript code
        driver.execute_script("$('#yard-id').val('1020');")
        driver.execute_script("$('#car-make').val('BMW');")
        driver.execute_script("$('#car-model').val('3 SERIES');")
        driver.execute_script("$('#car-model').change();")

        # Get the response from the website
        response = driver.page_source

        # Parse the HTML response
        soup = BeautifulSoup(response, 'html.parser')

        # Find the table element
        table = soup.find('table', class_='table')

        # Find all the rows in the table
        rows = table.find_all('tr')

        # Initialize a list of lists to store the table data
        table_data = []

        # Iterate over the rows
        for row in rows:
            # Find all the cells in the row
            cells = row.find_all('td')

            # Check if the row has at least 4 cells
            if len(cells) >= 4:
                # Add the row data to the table data list
                table_data.append([cells[0].text, cells[1].text, cells[2].text, cells[3].text])

        # Find the row names
        row_names = [row.text for row in rows[0].find_all('th')]

        # Import the tabulate library
        from tabulate import tabulate

        # Generate the formatted table
        formatted_table = tabulate(table_data, headers=row_names, tablefmt='rounded_outline', stralign= 'right' , numalign= ['left','right'])

        # Close the web driver
        driver.close()

        # Return the formatted table
        return "`" + formatted_table + "`\n" + current_time

    return 'I didn\'t understand what you wrote. Try typing "!help".'