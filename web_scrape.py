
from datetime import datetime
import time

from tabulate import tabulate

from database.db_inserts import insert_car_entry, car_entry_exists
from selenium import webdriver
from bs4 import BeautifulSoup
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException

def web_scrape(yard_id, car_make, car_model, yard_name):
    # Set up the Chrome options
    chrome_options = webdriver.ChromeOptions()
    chrome_options.headless = True  # Run Chrome in headless mode
    chrome_options.add_argument("--disable-gpu")  # Disable GPU acceleration (recommended for headless)
    chrome_options.add_argument("--window-size=1920x1080")  # Set default window size
    chrome_options.add_argument("--no-sandbox")  # Bypass OS security model (sometimes required)
    chrome_options.add_argument("--disable-dev-shm-usage")  # Overcome limited resource problems

    # Create the browser instance with the options
    driver = webdriver.Chrome(options=chrome_options)


    try:
        driver.get("http://inventory.pickapartjalopyjungle.com/")
        
        # Interact with dropdowns using Selenium
        yard_dropdown = Select(driver.find_element(By.ID, 'yard-id'))
        yard_dropdown.select_by_value(str(yard_id))

         # Wait for the model dropdown to load (This might need fine-tuning)
        #add back sleep for testing
        time.sleep(2)

        make_dropdown = Select(driver.find_element(By.ID, 'car-make'))

        # Initialize available makes here
        available_makes = [option.text for option in make_dropdown.options]

        try:
            make_dropdown.select_by_value(str(car_make))
        except NoSuchElementException:
            error_message = ("**Error:** The provided car make **" + car_make + "** was not found.\n\n"
                    "**Available Makes:**\n```\n" + '\n'.join(available_makes) + "\n\n```")
            raise ValueError(error_message)




        # Wait for the model dropdown to load (This might need fine-tuning)
        #add back sleep for testing
        time.sleep(2)
        # wait = WebDriverWait(driver, 10)
        # wait.until(EC.element_to_be_clickable((By.ID, 'car-model')))



        
        model_dropdown = Select(driver.find_element(By.ID, 'car-model'))

        # Initialize available models here
        available_models = [option.text for option in model_dropdown.options]

        try:
            model_dropdown.select_by_value(str(car_model))
        except NoSuchElementException:
            error_message = ("**Error:** The provided car model **" + car_model + "** was not found for make **" + car_make + "**.\n\n"
                    "**Available Models for " + car_make + ":**\n```\n" + '\n'.join(available_models) + "\n```")
            raise ValueError(error_message)
        
        # Click the search button
        driver.find_element(By.CSS_SELECTOR, "input[type='submit']").click()




        # Get the response from the website
        response = driver.page_source

    # Close the browser
    finally:
        driver.quit()


    # Parse the HTML response
    soup = BeautifulSoup(response, 'html.parser')

    # Find the table element
    table = soup.find('table', class_='table')

    # Find all the rows in the table
    rows = table.find_all('tr')

    # Initialize a list to store the table data
    table_data = [["Year", "Make", "Model", "Row Number", "Date First Seen"]]  # This initializes with column names

    # Initialize a list to store the new entries
    new_entries = []

    # Iterate over the rows
    for row in rows:
        # Find all the cells in the row
        cells = row.find_all('td')

        # Check if the row has at least 4 cells
        if len(cells) >= 4:
            # Extract the required data from the cells
            year = cells[0].text
            make = cells[1].text
            model = cells[2].text
            row_number = cells[3].text

            date_first_seen = car_entry_exists(yard_id, make, model, year, row_number)

            if date_first_seen is None:
                insert_car_entry(yard_id, make, model, year, row_number)
                new_entries.append([year, make, model, row_number])
                date_first_seen = datetime.now().strftime('%Y-%m-%d')
            
            # Add the row data along with date_first_seen to the table data list
            table_data.append([year, make, model, row_number, date_first_seen])


    
    # Generate the formatted table
    formatted_table = tabulate(table_data, tablefmt='rounded_outline', stralign='right', numalign=['left','right'])



    # Close the web driver
    driver.quit()




    # Construct the "other models to explore" message
    other_models_msg = "**Other " + car_make + " models to explore from " + yard_name + ":**\n```\n" + '\n'.join(available_models) + "\n```"

    # Return the formatted table and other models message back to discord
    return "`" + formatted_table + "\n" + yard_name + "`\n" + datetime.now().strftime("%A, %b-%d, %I:%M %p")  + "\n\n" + other_models_msg
