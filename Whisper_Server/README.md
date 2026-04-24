# Whisper Server (Core AI Hub)

The enterprise neural inference loop responsible for explicitly computing audio translations natively. By default, it operates completely offline across `http://127.0.0.1:8000` utilizing explicit CUDA offloading dynamically mapped inside a robust FastAPI execution server.

## Hardware & Environment Requirements
Because the server attempts to pre-load massive inference matrix weights actively natively against hardware, VRAM scaling dictates model load limitations. 
- **Large V3 Turbo**: > 4GB VRAM
- **Large V3**: > 8GB VRAM
- **Medium**: > 3GB VRAM
- **Small/Base**: Strict CPU mode runs perfectly at ~2GB System RAM.

## Installation
Ensure you maintain an isolated virtual environment (`.venv`) to securely map the runtime CUDA requirements independently against system limitations.
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running the Server
The central daemon explicitly respects bounds from its mapped `.env` configurations natively skipping CLI arguments dynamically.
```bash
python server.py
# Bootstrapping Uvicorn explicitly against mapped IPs
```
