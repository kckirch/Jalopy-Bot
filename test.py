from selenium import webdriver

driver = webdriver.Chrome()
driver.get('https://www.google.com')
search_box = driver.find_element("name", "q")

search_box.send_keys('Hello World')
search_box.submit()
