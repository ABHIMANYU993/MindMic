# Makefile for MindMic Whisper Server V2 (Default)

.PHONY: all run build run_v1 build_v1 clean help

# Configuration variables with sensible defaults
MODEL ?= parakeet
HOST ?= 127.0.0.1
PORT ?= 8000

# Default target
all: run

run:
	@echo "Starting Whisper/Parakeet Server V2 on $(HOST):$(PORT) with model '$(MODEL)'..."
	.venv/bin/python server.py --model $(MODEL) --host $(HOST) --port $(PORT)

build:
	@echo "Building Docker container for Server V2..."
	docker build -t mindmic-whisper-server:latest -f Dockerfile .

run_v1:
	@echo "Starting Whisper/Parakeet Server V1 on $(HOST):$(PORT) with model '$(MODEL)'..."
	cd v1 && ../.venv/bin/python server.py --model $(MODEL) --host $(HOST) --port $(PORT)

build_v1:
	@echo "Building Docker container for Server V1..."
	cd v1 && docker build -t mindmic-whisper-server-v1:latest -f Dockerfile .

clean:
	@echo "Cleaning up Python bytecode cache files..."
	find . -type d -name "__pycache__" -exec rm -r {} +
	find . -type f -name "*.pyc" -delete

help:
	@echo "Available commands:"
	@echo "  make run [MODEL=parakeet|distil-whisper] [HOST=127.0.0.1] [PORT=8000]"
	@echo "                   - Run Server V2 with specified arguments"
	@echo "  make build       - Build Docker image for Server V2"
	@echo "  make run_v1      - Run Server V1 from root"
	@echo "  make build_v1    - Build Docker image for Server V1"
	@echo "  make clean       - Clean up python cache files"
