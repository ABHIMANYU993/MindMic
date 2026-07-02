# Makefile for MindMic Whisper Server V1 (Legacy)

.PHONY: all run build clean help

# Configuration variables with sensible defaults for legacy version
MODEL ?= large-v3
HOST ?= 127.0.0.1
PORT ?= 8000

# Default target
all: run

run:
	@echo "Starting Whisper/Parakeet Server V1 on $(HOST):$(PORT) with model '$(MODEL)'..."
	../.venv/bin/python server.py --model $(MODEL) --host $(HOST) --port $(PORT)

build:
	@echo "Building Docker container for Server V1..."
	docker build -t mindmic-whisper-server-v1:latest -f Dockerfile .

clean:
	@echo "Cleaning up Python bytecode cache files..."
	find . -type d -name "__pycache__" -exec rm -r {} +
	find . -type f -name "*.pyc" -delete

help:
	@echo "Available commands:"
	@echo "  make run [MODEL=large-v3|parakeet|distil-whisper] [HOST=127.0.0.1] [PORT=8000]"
	@echo "                   - Run Server V1 with specified arguments"
	@echo "  make build       - Build Docker image for Server V1"
	@echo "  make clean       - Clean up python cache files"
