
import datetime
import time


from selenium import webdriver
from bs4 import BeautifulSoup
from selenium.webdriver.support.ui import Select
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException

def web_scrape(yard_id, car_make, car_model):
    driver = webdriver.Chrome()
    driver.get("http://inventory.pickapartjalopyjungle.com/")
    
    # Interact with dropdowns using Selenium
    yard_dropdown = Select(driver.find_element(By.ID, 'yard-id'))
    yard_dropdown.select_by_value(str(yard_id))

    make_dropdown = Select(driver.find_element(By.ID, 'car-make'))
    try:
        make_dropdown.select_by_value(str(car_make))
    except NoSuchElementException:
        available_makes = [option.text for option in make_dropdown.options]
        error_message = ("**Error:** The provided car make **" + car_make + "** was not found.\n\n"
                 "**Available Makes:**\n```\n" + '\n'.join(available_makes) + "\n\n```")
        raise ValueError(error_message) 

    # Wait for the model dropdown to update (This might need more fine-tuning, e.g., WebDriverWait)
    time.sleep(2)
    
    model_dropdown = Select(driver.find_element(By.ID, 'car-model'))
    try:
        model_dropdown.select_by_value(str(car_model))
    except NoSuchElementException:
        available_models = [option.text for option in model_dropdown.options]
        error_message = ("**Error:** The provided car model **" + car_model + "** was not found for make **" + car_make + "**.\n\n"
                 "**Available Models for " + car_make + ":**\n```\n" + '\n'.join(available_models) + "\n```")
        raise ValueError(error_message)
    
    # Click the search button
    driver.find_element(By.CSS_SELECTOR, "input[type='submit']").click()
    
    # Wait for the results page to load (This might need fine-tuning)
    # time.sleep(5)



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



    # Create the file name
    file_name = str(yard_id) + '_' + car_make + '_' + car_model + '.txt'

    # Open the file in write mode
    with open('Search_Backup/' + file_name, 'w') as f:
        # Write the timestamp to the file
        f.write(datetime.datetime.now().strftime("%A, %b-%d, %I:%M %p") + '\n')

        # Write the table data to the file
        for data in table_data:
            f.write(', '.join(data) + '\n')





    # Return the formatted table
    return "`" + formatted_table + "`\n" + datetime.datetime.now().strftime("%A, %b-%d, %I:%M %p")

