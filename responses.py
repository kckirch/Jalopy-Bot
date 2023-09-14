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
            car_model = ' '.join(args[3:]).upper()

            #testing on terminal
            print(location)
            print(car_make)
            print(car_model)

            # Convert the location name to a yard-id value
            try:
                yard_id = location_to_yard_id[location]
            except KeyError:
                return f"I'm sorry, I don't recognize the location '{location}'. Please try again with a valid location."
            
            result = web_scrape.web_scrape(yard_id, car_make, car_model)

            return result



        except Exception as e:
            return f'An error occurred: {e}'

    return 'I didn\'t understand what you wrote. Try typing "!help".'
