import asyncio
import websockets
import json
import httpx
import subprocess
import os
import pyaudio
import wave
import math
import struct

# --- CONFIG ---
WHISPER_URL = "http://127.0.0.1:8000/transcribe"
WS_PORT = 8765
CLI_PORT = 8766
CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000


class MindMicDaemon:
    def __init__(self):
        self.state = "idle"
        self.visibility_mode = "ephemeral"  # ephemeral or glassy
        self.ui_clients = []
        self.audio = pyaudio.PyAudio()
        self.stream = None
        self.frames = []
        self.config_path = os.path.expanduser("~/.config/mindmic_native_settings.json")
        self.config = self.load_settings()

    def load_settings(self):
        default_config = {
            "mode": "none",
            "language": "auto",
            "quality": "balanced",
            "model": "large-v3-turbo"
        }
        try:
            if os.path.exists(self.config_path):
                with open(self.config_path, "r") as f:
                    data = json.load(f)
                    default_config.update(data)
        except Exception as e:
            print(f"Error loading config: {e}")
        return default_config

    def save_settings(self):
        try:
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, "w") as f:
                json.dump(self.config, f, indent=4)
        except Exception as e:
            print(f"Error saving config: {e}")

    async def broadcast_state(self):
        if self.ui_clients:
            msg = json.dumps(
                {
                    "action": "state",
                    "status": self.state,
                    "visibility": self.visibility_mode,
                }
            )
            await asyncio.gather(*[client.send(msg) for client in self.ui_clients])

    async def broadcast_level(self, level):
        if self.ui_clients and self.state == "recording":
            msg = json.dumps({"action": "audioLevel", "level": level})
            await asyncio.gather(*[client.send(msg) for client in self.ui_clients])

    def calculate_rms(self, data):
        count = len(data) / 2
        shorts = struct.unpack(f"{int(count)}h", data)
        sum_squares = sum(s**2 for s in shorts)
        if count == 0:
            return 0
        rms = math.sqrt(sum_squares / count)
        return min(1.0, (rms / 32768.0) * 8.0)

    async def record_audio(self):
        self.stream = self.audio.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            frames_per_buffer=CHUNK,
        )
        self.frames = []
        try:
            while self.state == "recording":
                data = self.stream.read(CHUNK, exception_on_overflow=False)
                self.frames.append(data)
                level = self.calculate_rms(data)
                await self.broadcast_level(level)
                await asyncio.sleep(0.01)
        except Exception as e:
            print(f"Audio capture error: {e}")
        finally:
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()

    async def toggle(self, mode):
        self.visibility_mode = mode  # Set to "quick" (ephemeral) or "retained" (glassy)

        if self.state in ["idle", "expanded"]:
            self.state = "recording"
            await self.broadcast_state()
            asyncio.create_task(self.record_audio())

        elif self.state == "recording":
            self.state = "transcribing"
            await self.broadcast_state()

            temp_file = "/tmp/mindmic_buffer.wav"
            wf = wave.open(temp_file, "wb")
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(self.audio.get_sample_size(FORMAT))
            wf.setframerate(RATE)
            wf.writeframes(b"".join(self.frames))
            wf.close()

            async with httpx.AsyncClient() as client:
                try:
                    with open(temp_file, "rb") as f:
                        files = {"file": ("audio.wav", f, "audio/wav")}
                        data = {
                            "mode": self.config.get("mode", "none"),
                            "language": self.config.get("language", "auto"),
                            "quality": self.config.get("quality", "balanced")
                        }
                        response = await client.post(
                            WHISPER_URL, files=files, data=data, timeout=30.0
                        )
                        if response.status_code == 200:
                            data = response.json()
                            text = data.get("text", "").strip()
                            if text:
                                subprocess.run(["wtype", "--", text])
                except Exception as e:
                    print(f"Transcription error: {e}")

            self.state = "idle"
            await self.broadcast_state()

    # --- SERVERS ---
    async def ws_handler(self, websocket):
        self.ui_clients.append(websocket)
        try:
            await websocket.send(
                json.dumps(
                    {
                        "action": "state",
                        "status": self.state,
                        "visibility": self.visibility_mode,
                    }
                )
            )
            await websocket.wait_closed()
        finally:
            if websocket in self.ui_clients:
                self.ui_clients.remove(websocket)

    async def cli_server(self, reader, writer):
        try:
            data = b""
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break
                data += chunk
            
            message = data.decode().strip()
            if not message:
                writer.close()
                return

            response = {"status": "error", "message": "Unknown command"}
            
            if message.startswith("{"):
                payload = json.loads(message)
                action = payload.get("action")
                
                if action == "get_settings":
                    response = self.config
                elif action == "update_setting":
                    key = payload.get("key")
                    val = payload.get("value")
                    if key:
                        self.config[key] = val
                        self.save_settings()
                        response = {"status": "ok", "config": self.config}
                elif action == "get_models":
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(WHISPER_URL.replace("/transcribe", "/models"))
                        response = resp.json()
                elif action == "set_model":
                    model_id = payload.get("model")
                    async with httpx.AsyncClient() as client:
                        resp = await client.post(WHISPER_URL.replace("/transcribe", "/model"), json={"model": model_id})
                        response = resp.json()
                        self.config["model"] = model_id
                        self.save_settings()
                elif action == "health":
                    async with httpx.AsyncClient() as client:
                        resp = await client.get(WHISPER_URL.replace("/transcribe", "/health"))
                        response = resp.json()
            elif message.startswith("toggle_"):
                mode = "ephemeral" if "quick" in message else "glassy"
                await self.toggle(mode)
                response = {"status": "ok", "message": "Toggled recording"}
                
            writer.write(json.dumps(response).encode("utf-8"))
        except Exception as e:
            writer.write(json.dumps({"error": str(e)}).encode("utf-8"))
        finally:
            await writer.drain()
            writer.close()

    async def main(self):
        ws_server = await websockets.serve(self.ws_handler, "127.0.0.1", WS_PORT)
        cli_server = await asyncio.start_server(self.cli_server, "127.0.0.1", CLI_PORT)
        print("MindMic Native Daemon running...")
        await asyncio.gather(ws_server.wait_closed(), cli_server.serve_forever())


if __name__ == "__main__":
    daemon = MindMicDaemon()
    asyncio.run(daemon.main())
