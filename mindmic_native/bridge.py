import asyncio
import websockets
import sys


async def listen():
    uri = "ws://127.0.0.1:8765"
    try:
        async with websockets.connect(uri) as websocket:
            while True:
                message = await websocket.recv()
                # Print to stdout and flush so AGS reads it instantly
                print(message, flush=True)
    except Exception as e:
        print(f'{{"action": "error", "msg": "{e}"}}', flush=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(listen())
