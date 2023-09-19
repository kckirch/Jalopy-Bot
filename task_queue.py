import asyncio
import queue
import threading

from asyncio import run_coroutine_threadsafe


send_msg_coroutine = None

# Global task queue
task_queue = queue.Queue()

def start_worker(main_loop, send_message_func):
    global send_msg_coroutine
    send_msg_coroutine = send_message_func
    worker_thread = threading.Thread(target=worker, args=(main_loop,))
    worker_thread.start()



def worker(main_loop):
    while True:
        # Get the next task from the queue
        task = task_queue.get()

        # If the task is None, the worker will exit
        if task is None:
            break

        # Unpack the task details and process it
        message, user_message, is_private = task
        try:
            future = run_coroutine_threadsafe(
            send_msg_coroutine(message, user_message, is_private), 
            main_loop
        )
            future.result()
        except Exception as e:
            print(e)

        # Mark the task as done
        task_queue.task_done()



