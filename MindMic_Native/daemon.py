import asyncio
import json
import math
import struct
import subprocess
import os
import queue
import threading
from typing import List, Optional, Dict

from dotenv import load_dotenv

# Load explicit environment before any C++ bindings are imported
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import pyaudio
import numpy as np
import transcribe_cpp
import tempfile
from aiohttp import web

# --- SYSTEM DEFAULTS & GLOBALS ---
MODEL_PATH: str = os.getenv("MODEL_PATH")
if not MODEL_PATH:
    raise ValueError("FATAL: MODEL_PATH environment variable is not defined.")

TRANSCRIBE_CLI: str = os.getenv("TRANSCRIBE_CLI")
if not TRANSCRIBE_CLI:
    raise ValueError("FATAL: TRANSCRIBE_CLI environment variable is not defined.")

DAEMON_HOST: str = os.getenv("DAEMON_HOST", "127.0.0.1")
HTTP_PORT: int = int(os.getenv("HTTP_PORT", "8000"))
WS_PORT: int = int(os.getenv("AGS_TCP_PORT", "8765"))
CLI_PORT: int = int(os.getenv("CLI_TCP_PORT", "8766"))

# --- AUDIO CONFIGURATION ---
CHUNK: int = 1024
FORMAT: int = pyaudio.paInt16
CHANNELS: int = 1
RATE: int = 16000


class MindMicDaemon:
    """
    Enterprise-grade background daemon governing the MindMic transcription pipeline.

    Manages audio recording instances, captures PCM audio chunks from default sources,
    forwards audio streams to AI transcription endpoints, and acts as a central
    Raw TCP state synchronization provider for connected native Wayland interfaces.
    """

    def __init__(self) -> None:
        """
        Initializes the backend daemon with strict explicit defaults and instantiates
        the internal PyAudio processing context.
        """
        self.state: str = "idle"
        self.visibility_mode: str = "ephemeral"
        self.ui_writers: List[asyncio.StreamWriter] = []
        self.audio: pyaudio.PyAudio = pyaudio.PyAudio()
        self.stream: Optional[pyaudio.Stream] = None
        self.frames: List[bytes] = []

        try:
            print(f"[Core] Loading GGUF model into VRAM from {MODEL_PATH}")
            self.model = transcribe_cpp.Model(MODEL_PATH)
            print("[Core] Model loaded successfully.")
        except Exception as e:
            print(f"[Core] Fatal error loading ggml model: {e}")
            exit(1)

    async def broadcast_state(self) -> None:
        """
        Broadcasts the current structural state of the daemon to all active UI clients
        allowing connected widgets to properly layout and color themselves.
        """
        if not self.ui_writers:
            return

        payload: str = (
            json.dumps(
                {
                    "action": "state",
                    "status": self.state,
                    "visibility": self.visibility_mode,
                }
            )
            + "\n"
        )

        for writer in self.ui_writers:
            try:
                writer.write(payload.encode("utf-8"))
            except Exception:
                pass

    async def broadcast_level(self, level: float) -> None:
        """
        Transmits real-time calculated RMS audio levels to rendering clients
        for generating accurate responsive waveform UI components.

        Args:
            level (float): The calculated audio level volume (0.0 to 1.0).
        """
        if not self.ui_writers or self.state != "recording":
            return

        payload: str = json.dumps({"action": "audioLevel", "level": level}) + "\n"
        for writer in self.ui_writers:
            try:
                writer.write(payload.encode("utf-8"))
            except Exception:
                pass

    def calculate_rms(self, data: bytes) -> float:
        """
        Derives the Root Mean Square (RMS) volume level representation
        extracted from raw audio bytes payload.

        Args:
            data (bytes): Chunk of audio byte streams.

        Returns:
            float: Fluid bounded volume level representation clamped within [0, 1.0].
        """
        count: int = len(data) // 2
        shorts = struct.unpack(f"{count}h", data)
        sum_squares: int = sum(s**2 for s in shorts)

        if count == 0:
            return 0.0

        rms: float = math.sqrt(sum_squares / count)
        level: float = (rms / 32768.0) * 8.0
        return min(1.0, level)

    def _streaming_worker(
        self, audio_queue: queue.Queue, result_container: dict
    ) -> None:
        """
        Synchronous background worker consuming live audio chunks from the microphone.
        Attempts direct C++ stream feeding, falling back to batch inference if the
        loaded model does not implement the streaming API.
        """
        audio_chunks = []
        stream_active = False
        stream = None
        session = None

        try:
            session = self.model.session()
            session.__enter__()
            stream = session.stream()
            stream.__enter__()
            stream_active = True
        except Exception:
            print(
                "[Core] Streaming not supported by model, falling back to batch threaded mode."
            )

        try:
            while True:
                item = audio_queue.get()
                if item is None:
                    break

                if stream_active:
                    stream.feed(item)
                else:
                    audio_chunks.append(item)

                audio_queue.task_done()

            text_str = ""
            if stream_active:
                stream.finalize()
                text_obj = stream.text()
                text_str = (
                    text_obj.committed
                    if hasattr(text_obj, "committed")
                    else str(text_obj)
                )
                text_str = text_str.strip()
            elif audio_chunks:
                full_audio = np.concatenate(audio_chunks)
                result = session.run(full_audio)
                text_str = result.text.strip()

            result_container["text"] = text_str

        except Exception as e:
            print(f"[Streaming Worker] Error: {e}")
            result_container["text"] = ""
        finally:
            if stream_active and stream:
                stream.__exit__(None, None, None)
            if session:
                session.__exit__(None, None, None)

            # Ensure the None sentinel is marked as done
            audio_queue.task_done()

    async def record_audio(self) -> None:
        """
        Activates the main microphone stream recording sequence capturing buffers.
        Operates fully asynchronously resolving bytes directly against internal `self.frames`.
        """
        self.stream = self.audio.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            frames_per_buffer=CHUNK,
        )
        self.frames.clear()

        try:
            while self.state == "recording":
                # Collect live buffer ignoring silent overflow boundaries
                data: bytes = self.stream.read(CHUNK, exception_on_overflow=False)
                self.frames.append(data)

                # Emit rendering level updates automatically
                level: float = self.calculate_rms(data)

                audio_float32 = (
                    np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                )
                self.audio_queue.put(audio_float32)

                await self.broadcast_level(level)
                await asyncio.sleep(0.01)
        except Exception as e:
            print(f"[Core] Audio capture pipeline error execution: {e}")
        finally:
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()

    async def get_active_window_class(self) -> str:
        """
        Queries hyprctl to retrieve the class of the currently focused window.
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "hyprctl",
                "activewindow",
                "-j",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, _ = await proc.communicate()
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode("utf-8"))
                return data.get("class", "").lower()
        except Exception as e:
            print(f"[Hyprctl] Error fetching active window class: {e}")
        return ""

    async def toggle(self, mode: str) -> None:
        """
        Primary toggle router triggered across internal UI callbacks or CLI hooks.
        Rotates system states: `idle` -> `recording` -> `transcribing` -> `idle`.

        Args:
            mode (str): Requested visual layout mode (e.g. `ephemeral`, `glassy`).
        """
        self.visibility_mode = mode

        # Transition Idle -> Recording
        if self.state in ["idle", "expanded"]:
            self.state = "recording"
            self.audio_queue = queue.Queue()
            self.stream_result = {}
            threading.Thread(
                target=self._streaming_worker,
                args=(self.audio_queue, self.stream_result),
                daemon=True,
            ).start()
            await self.broadcast_state()
            asyncio.create_task(self.record_audio())

        # Transition Recording -> Transcribing -> Idle (Execution loop)
        elif self.state == "recording":
            # Check if recording is too short (less than ~0.45 seconds / 7 frames)
            if len(self.frames) < 7:
                print(
                    f"[Core] Recording too short ({len(self.frames)} frames), discarding."
                )
                self.frames.clear()
                self.state = "idle"
                self.audio_queue.put(None)
                await self.broadcast_state()
                return

            self.state = "transcribing"
            self.audio_queue.put(None)
            await self.broadcast_state()

            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, self.audio_queue.join)
                text = self.stream_result.get("text", "")
                if text:
                    # Small delay to ensure physical modifier keys (like SUPER) are released
                    await asyncio.sleep(0.4)

                    # Copy text to standard clipboard and primary selection
                    try:
                        # Copy to clipboard
                        proc_clip = await asyncio.create_subprocess_exec(
                            "wl-copy", stdin=subprocess.PIPE
                        )
                        await proc_clip.communicate(input=text.encode("utf-8"))

                        # Copy to primary selection
                        proc_prim = await asyncio.create_subprocess_exec(
                            "wl-copy", "--primary", stdin=subprocess.PIPE
                        )
                        await proc_prim.communicate(input=text.encode("utf-8"))
                    except Exception as e:
                        print(f"[wl-clipboard] Error copying text: {e}")

                    # Detect the active window class
                    window_class = await self.get_active_window_class()

                    # Choose the appropriate paste shortcut
                    terminal_classes = {
                        "kitty",
                        "alacritty",
                        "foot",
                        "wezterm",
                        "konsole",
                        "gnome-terminal",
                        "xfce4-terminal",
                        "urxvt",
                        "xterm",
                        "termite",
                        "rio",
                        "ghostty",
                    }
                    is_terminal = any(term in window_class for term in terminal_classes)

                    # Simulate paste keypress
                    try:
                        if is_terminal:
                            # Use Ctrl+Shift+V for terminals
                            proc_paste = await asyncio.create_subprocess_exec(
                                "wtype",
                                "-M",
                                "ctrl",
                                "-M",
                                "shift",
                                "-k",
                                "v",
                                "-m",
                                "shift",
                                "-m",
                                "ctrl",
                            )
                        else:
                            # Use Ctrl+V for standard GUI applications
                            proc_paste = await asyncio.create_subprocess_exec(
                                "wtype", "-M", "ctrl", "-k", "v", "-m", "ctrl"
                            )
                        await proc_paste.wait()
                    except Exception as e:
                        print(f"[wtype] Failed to paste: {e}")
            except Exception as e:
                print(f"[Core] Transcription process error context: {e}")

            # Restore pipeline closure back mapping to default standard
            self.state = "idle"
            await self.broadcast_state()

    async def handle_transcribe(self, request: web.Request) -> web.Response:
        """
        Isolated HTTP endpoint for parsing audio file uploads (mp3/wav),
        decoding via ffmpeg, and running through the VRAM-locked model.
        """
        reader = await request.multipart()
        field = await reader.next()

        if field is None:
            return web.json_response({"error": "No file uploaded"}, status=400)

        filename = field.filename
        if not filename:
            return web.json_response({"error": "Empty filename"}, status=400)

        # Write uploaded file to temporary storage securely
        fd, temp_input_path = tempfile.mkstemp(suffix="_mindmic_upload")
        fd2, temp_audio_wav = tempfile.mkstemp(suffix="_mindmic_audio.wav")
        os.close(fd2)  # We just need the path
        try:
            with os.fdopen(fd, "wb") as f:
                while True:
                    chunk = await field.read_chunk()
                    if not chunk:
                        break
                    f.write(chunk)

            # Spawn ffmpeg to convert to 16kHz wav on disk
            ffmpeg_proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-y",
                "-i",
                temp_input_path,
                "-ar",
                "16000",
                "-ac",
                "1",
                temp_audio_wav,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            stdout_data, stderr_data = await ffmpeg_proc.communicate()
            if ffmpeg_proc.returncode != 0:
                print(f"[HTTP] FFmpeg error: {stderr_data.decode()}")
                return web.json_response(
                    {"error": "Failed to decode audio file"}, status=400
                )

            # Spawn the native C++ engine
            proc = await asyncio.create_subprocess_exec(
                TRANSCRIBE_CLI, "-m", MODEL_PATH, temp_audio_wav,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            output = stdout.decode("utf-8")
            
            # Parse the proprietary transcribe-cli stdout format
            text = ""
            if "text: " in output:
                text_part = output.split("text: ", 1)[1]
                # Strip the diagnostic footer that typically follows the text
                if "\n  realtime:" in text_part:
                    text_part = text_part.split("\n  realtime:", 1)[0]
                text = text_part.strip()
                if text == "(empty)":
                    text = ""
            elif proc.returncode != 0:
                print(f"[HTTP] CLI error: {stderr.decode('utf-8')}")
                return web.json_response({"error": "Transcription engine failed"}, status=500)
            else:
                text = output.strip()
            
            return web.json_response({"text": text})

        except Exception as e:
            print(f"[HTTP] Transcribe endpoint error: {e}")
            return web.json_response({"error": str(e)}, status=500)
        finally:
            if os.path.exists(temp_input_path):
                os.remove(temp_input_path)
            if os.path.exists(temp_audio_wav):
                os.remove(temp_audio_wav)

    async def http_server(self) -> web.AppRunner:
        """
        Instantiates the aiohttp application mapping and starts the site runner.
        """
        app = web.Application()
        app.router.add_post("/transcribe", self.handle_transcribe)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, DAEMON_HOST, HTTP_PORT)
        await site.start()
        print(f"[MindMic] HTTP Server engaged on {DAEMON_HOST}:{HTTP_PORT}/transcribe")
        return runner

    # -----------------------------
    # NETWORK SERVERS & EVENT LOOPS
    # -----------------------------

    async def ui_server(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """
        Handles explicit Raw TCP initialization lifecycle mappings for
        connecting JavaScript components updating UI layouts asynchronously.
        """
        self.ui_writers.append(writer)
        try:
            init_payload: str = (
                json.dumps(
                    {
                        "action": "state",
                        "status": self.state,
                        "visibility": self.visibility_mode,
                    }
                )
                + "\n"
            )
            writer.write(init_payload.encode("utf-8"))
            await writer.drain()

            # Persist connection indefinitely until pipe snaps
            while True:
                data = await reader.read(1024)
                if not data:
                    break
        except Exception:
            pass
        finally:
            if writer in self.ui_writers:
                self.ui_writers.remove(writer)
            try:
                writer.close()
            except Exception:
                pass

    async def cli_server(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        """
        Low latency async socket TCP reader tracking inbound strings
        transmitted globally via CLI. Interprets actions routing directly to self.
        """
        try:
            data_bytes: bytes = b""
            while True:
                chunk: bytes = await reader.read(4096)
                if not chunk:
                    break
                data_bytes += chunk

            message: str = data_bytes.decode().strip()
            if not message:
                writer.close()
                return

            # Execute explicit toggle maps
            if message.startswith("toggle_"):
                ui_mode: str = "ephemeral" if "quick" in message else "glassy"
                await self.toggle(ui_mode)

                resp_payload: Dict[str, str] = {
                    "status": "ok",
                    "message": "Toggled recording sequence",
                }
                writer.write(json.dumps(resp_payload).encode("utf-8"))

        except Exception as e:
            writer.write(json.dumps({"error": str(e)}).encode("utf-8"))
        finally:
            await writer.drain()
            writer.close()

    async def main(self) -> None:
        """Bootstraps networking instances tying to event loop and listens indefinitely."""
        ags_server = await asyncio.start_server(self.ui_server, DAEMON_HOST, WS_PORT)
        cli_server = await asyncio.start_server(self.cli_server, DAEMON_HOST, CLI_PORT)
        http_runner = await self.http_server()

        print(
            f"[MindMic] Enterprise Native Daemon engaged successfully against {DAEMON_HOST} on explicit ports."
        )
        try:
            await asyncio.gather(ags_server.serve_forever(), cli_server.serve_forever())
        finally:
            await http_runner.cleanup()


if __name__ == "__main__":
    daemon = MindMicDaemon()
    asyncio.run(daemon.main())
