import asyncio
import json
import math
import struct
import subprocess
import wave
import os
from typing import List, Optional, Dict, Any

from dotenv import load_dotenv
import httpx
import pyaudio

# Load explicit environment
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# --- SYSTEM DEFAULTS & GLOBALS ---
WHISPER_URL: str = os.getenv("WHISPER_URL", "http://127.0.0.1:8000/transcribe")
DAEMON_HOST: str = os.getenv("DAEMON_HOST", "127.0.0.1")
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

    async def broadcast_state(self) -> None:
        """
        Broadcasts the current structural state of the daemon to all active UI clients
        allowing connected widgets to properly layout and color themselves.
        """
        if not self.ui_writers:
            return

        payload: str = json.dumps({
            "action": "state",
            "status": self.state,
            "visibility": self.visibility_mode,
        }) + "\n"
        
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
                await self.broadcast_level(level)
                await asyncio.sleep(0.01)
        except Exception as e:
            print(f"[Core] Audio capture pipeline error execution: {e}")
        finally:
            if self.stream:
                self.stream.stop_stream()
                self.stream.close()

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
            await self.broadcast_state()
            asyncio.create_task(self.record_audio())

        # Transition Recording -> Transcribing -> Idle (Execution loop)
        elif self.state == "recording":
            # Check if recording is too short (less than ~0.45 seconds / 7 frames)
            if len(self.frames) < 7:
                print(f"[Core] Recording too short ({len(self.frames)} frames), discarding.")
                self.frames.clear()
                self.state = "idle"
                await self.broadcast_state()
                return

            self.state = "transcribing"
            await self.broadcast_state()

            # Compile standard WAV structure inside virtual temporary memory block 
            temp_file: str = "/tmp/mindmic_buffer.wav"
            with wave.open(temp_file, "wb") as wf:
                wf.setnchannels(CHANNELS)
                wf.setsampwidth(self.audio.get_sample_size(FORMAT))
                wf.setframerate(RATE)
                wf.writeframes(b"".join(self.frames))

            # Transmit constructed audio toward Whisper APIs mapping against default options
            async with httpx.AsyncClient() as client:
                try:
                    with open(temp_file, "rb") as f:
                        files = {"file": ("audio.wav", f, "audio/wav")}
                        data: Dict[str, str] = {
                            "mode": "none",
                            "language": "en",
                            "quality": "balanced"
                        }
                        
                        response: httpx.Response = await client.post(
                            WHISPER_URL, files=files, data=data, timeout=30.0
                        )
                        
                        # Upon successful HTTP fetch, invoke Wayland virtual keystroke inputs (wtype)
                        if response.status_code == 200:
                            resp_payload: Dict[str, Any] = response.json()
                            text: str = resp_payload.get("text", "").strip()
                            if text:
                                # Small delay to ensure physical modifier keys (like SUPER) are released
                                await asyncio.sleep(0.4)
                                subprocess.run(["wtype", "--", text], check=False)
                except Exception as e:
                    print(f"[Network] Transcription process error context: {e}")

            # Restore pipeline closure back mapping to default standard
            self.state = "idle"
            await self.broadcast_state()

    # -----------------------------
    # NETWORK SERVERS & EVENT LOOPS
    # -----------------------------

    async def ui_server(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """
        Handles explicit Raw TCP initialization lifecycle mappings for 
        connecting JavaScript components updating UI layouts asynchronously.
        """
        self.ui_writers.append(writer)
        try:
            init_payload: str = json.dumps({
                "action": "state",
                "status": self.state,
                "visibility": self.visibility_mode,
            }) + "\n"
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


    async def cli_server(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
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
                
                resp_payload: Dict[str, str] = {"status": "ok", "message": "Toggled recording sequence"}
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
        
        print(f"[MindMic] Enterprise Native Daemon engaged successfully against {DAEMON_HOST} on explicit ports.")
        await asyncio.gather(ags_server.serve_forever(), cli_server.serve_forever())


if __name__ == "__main__":
    daemon = MindMicDaemon()
    asyncio.run(daemon.main())
