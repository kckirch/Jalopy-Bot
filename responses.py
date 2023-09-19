import requests
import datetime
import time
import web_scrape

from selenium import webdriver
from bs4 import BeautifulSoup

def get_response(message: str) -> list:
    p_message = message.lower()

    if p_message == '!help':
        return ['`!s location car_make [optional car_model]` - Search for a car at a specific location. For example: `!s BOISE HONDA ACCORD` \n\n' + 'location options: \n\n BOISE, CALDWELL, GARDENCITY, NAMPA, TWINFALLS']

    location_to_yard_id = {
        'BOISE': 1020,
        'CALDWELL': 1021,
        'GARDENCITY': 1119,
        'NAMPA': 1022,
        'TWINFALLS': 1099,
    }    

    if p_message.startswith('!s'):
        try:
            args = message.split(' ')
            
            # Ensure at least location and car_make are provided
            if len(args) < 3:
                return ["Expected format: `!s location car_make [optional car_model]`. For example: `!s BOISE HONDA ACCORD`."]

            location = args[1].upper().strip(' ')
            car_make = args[2].upper().strip()
            car_model = ' '.join(args[3:]).upper()

            # For the "ALL" scenario
            if location == "ALL":
                responses = []
                for loc in location_to_yard_id:
                    try:
                        yard_id = location_to_yard_id[loc]
                        result = web_scrape.web_scrape(yard_id, car_make, car_model, loc)
                        responses.append(result)
                    except Exception as e:
                        responses.append(f'An error occurred for {loc}: {e}')
                return responses
            
            # Handle a specific location
            try:
                yard_id = location_to_yard_id[location]
                result = [web_scrape.web_scrape(yard_id, car_make, car_model, location)]
                return result
            except KeyError:
                return [f"I'm sorry, I don't recognize the location '{location}'. Please try again with a valid location. The options are " '\n' + "**BOISE**" + '\n' + "**CALDWELL**" + '\n' + "**GARDENCITY**" + '\n' + "**NAMPA**" + '\n' + "**TWINFALLS**" + '\n' + "Example: !s BOISE HONDA ACCORD"]

        except Exception as e:
            return [f'An error occurred: {e}']

    return ['I didn\'t understand what you wrote. Try typing "!help".']