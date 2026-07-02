# Dockerfile for Whisper_Server V2 (Default)
FROM python:3.11-slim

# Install system dependencies
# ffmpeg: required for audio conversions
# libsndfile1: required by soundfile library
# git & g++: required to build and install nemo-toolkit[asr]
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    git \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements file first to cache pip installation layer
COPY requirements.txt .

# Install PyTorch with CUDA 12.1 support
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# Install nemo-toolkit[asr] and other dependencies
RUN pip install --no-cache-dir nemo-toolkit[asr] && \
    pip install --no-cache-dir -r requirements.txt

# Copy only the necessary server source code and configuration example
COPY server.py .
COPY .env.example .env

# Expose port 8000
EXPOSE 8000

# Start server
CMD ["python", "server.py"]
