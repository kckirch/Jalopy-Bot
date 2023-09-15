import requests
import datetime
import time
import web_scrape

from selenium import webdriver
from bs4 import BeautifulSoup

#datetime.datetime.now().strftime("%A, %b-%d, %I:%M %p")

def get_response(message: str) -> str:
    p_message = message.lower()

    if p_message == '!help':


        return '`!s location car_make [optional car_model]` - Search for a car at a specific location. For example: `!s BOISE HONDA ACCORD` \n\n' + 'location options: \n\n BOISE, CALDWELL, GARDENCITY, NAMPA, TWINFALLS'




    location_to_yard_id = {
    'BOISE': 1020,
    'CALDWELL': 1021,
    'GARDENCITY': 1119,
    'NAMPA': 1022,
    'TWINFALLS': 1099,

}    

    if p_message.startswith('!s'):
        try:
            # Split the message by ' ' and extract the arguments
            args = message.split(' ')
            
            # Check if at least location and car_make are provided
            if len(args) < 3:
                return "Expected format: `!s location car_make [optional car_model]`. For example: `!s BOISE HONDA ACCORD`."

            location = args[1].upper().strip(' ')
            car_make = args[2].upper().strip()
            
            # Set car_model to None (or an empty string) if not provided
            car_model = ' '.join(args[3:]).upper()

            #testing on terminal
            print(location)
            print(car_make)
            print(car_model)

            # Convert the location name to a yard-id value
            try:
                yard_id = location_to_yard_id[location]
            except KeyError:
                return f"I'm sorry, I don't recognize the location '{location}'. Please try again with a valid location. The options are " '\n' + "**BOISE**" + '\n' + "**CALDWELL**" + '\n' + "**GARDENCITY**" + '\n' + "**NAMPA**" + '\n' + "**TWINFALLS**" + '\n' + "Example: !s BOISE HONDA ACCORD"
            
            result = web_scrape.web_scrape(yard_id, car_make, car_model)

            return result



        except Exception as e:
            return f'An error occurred: {e}'

    return 'I didn\'t understand what you wrote. Try typing "!help".'
