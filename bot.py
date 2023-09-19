import asyncio
import discord
import responses
import config

from task_queue import start_worker, task_queue




async def send_message_coroutine(message, user_message, is_private):
    try:
        response_messages = responses.get_response(user_message)
        
        for response in response_messages:
            await message.author.send(response) if is_private else await message.channel.send(response)
            await asyncio.sleep(1)  # Optional: To introduce a short delay between messages

    except Exception as e:
        print(e)




def run_discord_bot():

    intents = discord.Intents.default()
    intents.messages = True
    client = discord.Client(intents=intents)

    # Reference to the main event loop
    main_loop = asyncio.get_event_loop()
    start_worker(main_loop, send_message_coroutine)

    @client.event
    async def on_ready():
        print(f'{client.user} is now running!')

    @client.event
    async def on_message(message):
        if message.author == client.user:
            return

        username = str(message.author)
        user_message = str(message.content)
        channel = str(message.channel)
        is_private = user_message[0] == '?'
        
        if is_private:
            user_message = user_message[1:]
        
        print(f'{username} said: "{user_message}" ({channel})')
        
        # Add task to queue
        task_queue.put((message, user_message, is_private))


        print(f"Received message from {message.author}: {user_message}")
        if user_message.startswith('!s'):

            print("Processing !s command...")

            args = user_message.split(' ')
            
            # Extract location, car_make, and optionally car_model.
            location = args[1].upper().strip(' ') if len(args) > 1 else "N/A"
            car_make = args[2].upper().strip() if len(args) > 2 else "N/A"
            car_model = ' '.join(args[3:]).upper() if len(args) > 3 else "All Models"
            
            await message.channel.send(f"🔍 Starting search in `{location}` for `{car_make} {car_model}`. Please wait...")
            print(f"Sent response for {message.author}")




        # if user_message[0] == '?':
        #     user_message = user_message[1:]
        #     await send_message(message, user_message, is_private=True)
        # else:
        #     await send_message(message, user_message, is_private=False)

    client.run(config.TOKEN)


if __name__ == "__main__":
    run_discord_bot()