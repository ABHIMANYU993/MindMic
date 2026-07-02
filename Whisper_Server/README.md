# Whisper/Parakeet Voice Server V2 (Default)

The neural voice transcription server running FastAPI to power the MindMic dictation pipeline. Version 2 default features:
- **NVIDIA Parakeet-TDT (0.6B v3)**: Default, ultra-low latency, running on PyTorch with CUDA in FP16 mode.
- **Distil-Whisper Large V3**: Highly accurate, running on CTranslate2.

## Getting Started

### Installation
Ensure you have `ffmpeg` installed on your host system:
```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg libsndfile1

# Arch Linux
sudo pacman -S ffmpeg libsndfile
```

Set up the virtual environment:
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Running the Server
You can control the server using the provided `Makefile`:
```bash
# Run the default Parakeet model on CUDA
make run

# Run with Distil-Whisper instead
make run MODEL=distil-whisper

# Customize host and port
make run MODEL=parakeet HOST=0.0.0.0 PORT=8080
```

### Running with Docker
Build and run the lightweight container:
```bash
# Build the container
make build

# Run the container (requires NVIDIA Container Toolkit for GPU)
docker run --gpus all -p 8000:8000 mindmic-whisper-server:latest
```
