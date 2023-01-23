
import datetime


from selenium import webdriver
from bs4 import BeautifulSoup

def web_scrape(yard_id, car_make, car_model):

    # Set up the web driver
    driver = webdriver.Chrome()

    # Navigate to the website
    driver.get("http://inventory.pickapartjalopyjungle.com/")

    # Execute the JavaScript code
    driver.execute_script(f"$('#yard-id').val('{yard_id}');")
    driver.execute_script(f"$('#car-make').val('{car_make}');")
    driver.execute_script(f"$('#car-model').val('{car_model}');")



    driver.execute_script("$('#car-make').change();")
    #time.sleep(5)



    driver.execute_script(f"$('#car-model').val('{car_model}').change();")

    #after running .change() it seems to set the defaul model to Select Model and not the specified model
    #will probably need to look at how it is submitting the form data requests
    #it probably is because after the model gets loaded in we still need to rehit the submit button. I think were just refreshing the make over and over

    #driver.execute_script(f"alert('no change yet');")
    #time.sleep(5)

    driver.execute_script("$('#car-model').change();")
    #time.sleep(5)


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

