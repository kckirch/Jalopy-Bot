import requests
import datetime
import time

from selenium import webdriver
from bs4 import BeautifulSoup

current_time = datetime.datetime.now().strftime("%A, %b-%d, %I:%M %p")

def get_response(message: str) -> str:
    p_message = message.lower()

    if p_message == '!help':
        return '`Welcome to the Jalopy Jungle Bot \n \nI am being built to help notify users for new car inventory. \n`'




    location_to_yard_id = {
    'BOISE': 1020,
    'CALDWELL': 1021,
    'GARDENCITY': 1119,
    'NAMPA': 1022,
    'TWINFALLS': 1099,

}    

    if p_message.startswith('!s'):
        try:
            # Split the message by ',' and extract the arguments
            args = message.split(' ')
            location = args[1].upper().strip(' ')
            car_make = args[2].upper().strip()
            car_model = ' '.join(args[3:])

            #testing
            print(location)
            print(car_make)
            print(car_model)

            # Convert the location name to a yard-id value
            try:
                yard_id = location_to_yard_id[location]
            except KeyError:
                return f"I'm sorry, I don't recognize the location '{location}'. Please try again with a valid location."

            # Set up the web driver
            driver = webdriver.Chrome()

            # Navigate to the website
            driver.get("http://inventory.pickapartjalopyjungle.com/")

            # Execute the JavaScript code
            driver.execute_script(f"$('#yard-id').val('{yard_id}');")
            driver.execute_script(f"$('#car-make').val('{car_make}');")
            driver.execute_script(f"$('#car-model').val('{car_model}');")


            
            driver.execute_script("$('#car-make').change();")
            time.sleep(5)

            
            
            driver.execute_script(f"$('#car-model').val('{car_model}').change();")

            #after running .change() it seems to set the defaul model to Select Model and not the specified model
            #will probably need to look at how it is submitting the form data requests
            #it probably is because after the model gets loaded in we still need to rehit the submit button. I think were just refreshing the make over and over
            
            #driver.execute_script(f"alert('no change yet');")
            time.sleep(5)

            driver.execute_script("$('#car-model').change();")
            time.sleep(5)


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
        except Exception as e:
            return f'An error occurred: {e}'

    return 'I didn\'t understand what you wrote. Try typing "!help".'
