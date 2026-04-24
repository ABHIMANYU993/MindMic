# Whisper Server (Core AI Hub)

The enterprise neural inference loop responsible for explicitly computing audio translations dynamically locally. Utilizing CTranslate2, the engine explicitly hooks directly against raw Nvidia CUDA primitives completely decoupling from heavy wrappers like PyTorch resulting in immense inference latency drops!

## Model Tier Map
The server ships supporting multiple Whisper variations which can be hot-swapped over native commands mapping against specific hardware profiles:
- **`large-v3-turbo`** *(Default)*: Extremely fast, massive accuracy. > 4GB VRAM target.
- **`large-v3`**: Perfect accuracy mapping, heavy weight. > 8GB VRAM target.
- **`medium`**: Good speed/accuracy balance. > 3GB VRAM target.
- **`small`**: High speed accuracy. > 2GB VRAM target.
- **`base`**: The ultimate fallback. Can strictly run in pure int8 CPU mode bridging system ram mapping perfectly.

## Installation Pipeline
Because the environment natively hooks absolute CUDA mappings, the Python `venv` strictly serves the `.so` bindings.

```bash
cd Whisper_Server
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Executing Inference Daemon
The fastAPI executable spins actively picking up constants dynamically against the `.env` local configurations seamlessly!
```bash
python server.py
```
