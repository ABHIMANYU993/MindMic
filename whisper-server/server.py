from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import uvicorn
import tempfile
import os
import sys
import re
import time

# ── CUDA Library Pre-Loading ───────────────────────────
# ONLY looks inside the active Python interpreter's venv.
# No hardcoded pyenv paths. No system paths. Just what's installed.
import ctypes
import glob

_venv_sp = os.path.join(
    sys.prefix, "lib",
    f"python{sys.version_info.major}.{sys.version_info.minor}",
    "site-packages", "nvidia",
)
_cuda_ok = False

if os.path.isdir(_venv_sp):
    # Pre-load CUDA shared libs BEFORE importing faster_whisper/ctranslate2.
    # Setting LD_LIBRARY_PATH via os.environ does NOT work after process start
    # because the dynamic linker caches it. ctypes.CDLL is the real fix.
    _libs_to_load = [
        "cublas/lib/libcublas.so.*",
        "cublas/lib/libcublasLt.so.*",
        "cudnn/lib/libcudnn.so.*",
        "cuda_nvrtc/lib/libnvrtc.so.*",
        "cuda_runtime/lib/libcudart.so.*",
    ]
    _loaded = []
    for _pat in _libs_to_load:
        for _f in sorted(glob.glob(os.path.join(_venv_sp, _pat))):
            try:
                ctypes.CDLL(_f, mode=ctypes.RTLD_GLOBAL)
                _loaded.append(os.path.basename(_f))
            except OSError:
                pass
    if _loaded:
        _cuda_ok = True
        print(f"✅ CUDA libs preloaded from venv: {', '.join(_loaded)}")
    else:
        print("⚠️  nvidia packages installed but no CUDA libs loadable")
else:
    print("ℹ️  No nvidia packages in this venv — will use CPU")

# ── App ────────────────────────────────────────────────
app = FastAPI(title="MindMic Voice Server", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Available Models ───────────────────────────────────
AVAILABLE_MODELS = [
    {"id": "large-v3-turbo", "name": "Whisper Large v3 Turbo", "params": "809M", "speed": "fastest", "accuracy": "high"},
    {"id": "large-v3", "name": "Whisper Large v3", "params": "1550M", "speed": "slow", "accuracy": "highest"},
    {"id": "medium", "name": "Whisper Medium", "params": "769M", "speed": "medium", "accuracy": "good"},
    {"id": "small", "name": "Whisper Small", "params": "244M", "speed": "fast", "accuracy": "moderate"},
    {"id": "base", "name": "Whisper Base", "params": "74M", "speed": "fastest", "accuracy": "basic"},
]

# Quality presets — balanced is default
QUALITY_PRESETS = {
    "fast":     {"beam_size": 1, "best_of": 1, "temperature": [0.0]},
    "balanced": {"beam_size": 3, "best_of": 3, "temperature": [0.0, 0.2, 0.4]},
    "best":     {"beam_size": 5, "best_of": 5, "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]},
}

# ── Model Manager ─────────────────────────────────────
model = None
model_name = "large-v3-turbo"
device_used = "loading"
model_loading = False


def _try_load(name, device, compute):
    """Attempt to load a specific model on a device."""
    global model, model_name, device_used
    m = WhisperModel(name, device=device, compute_type=compute)
    model = m
    model_name = name
    device_used = device
    print(f"✅ Model '{name}' loaded on {device} ({compute})")
    return True


def load_model(name="large-v3-turbo"):
    """Load a whisper model with CUDA → CPU fallback chain."""
    global model_loading
    model_loading = True
    try:
        # Try CUDA float16
        try:
            _try_load(name, "cuda", "float16")
            return
        except Exception as e:
            print(f"⚠️  CUDA float16 failed for '{name}': {e}")

        # Try CPU int8
        try:
            _try_load(name, "cpu", "int8")
            return
        except Exception as e:
            print(f"⚠️  CPU int8 failed for '{name}': {e}")

        # Ultimate fallback — base model on CPU
        if name != "base":
            print("⚠️  Falling back to 'base' model on CPU")
            try:
                _try_load("base", "cpu", "int8")
                return
            except Exception as e:
                print(f"❌ All model loads failed: {e}")
                sys.exit(1)
    finally:
        model_loading = False


# Load default on startup
load_model()


# ── Endpoints ──────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": model_name,
        "device": device_used,
        "loading": model_loading,
    }


@app.get("/models")
async def list_models():
    """List available models and which one is active."""
    models = []
    for m in AVAILABLE_MODELS:
        models.append({**m, "active": m["id"] == model_name})
    return {"models": models, "active": model_name, "device": device_used}


@app.post("/model")
async def change_model(body: dict):
    """Hot-swap the loaded model."""
    new_model = body.get("model", "").strip()
    valid_ids = [m["id"] for m in AVAILABLE_MODELS]
    if new_model not in valid_ids:
        return JSONResponse(status_code=400, content={
            "error": f"Unknown model '{new_model}'. Valid: {valid_ids}"
        })
    if new_model == model_name and not model_loading:
        return {"status": "already_loaded", "model": model_name, "device": device_used}

    load_model(new_model)
    return {"status": "loaded", "model": model_name, "device": device_used}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(None),
    quality: str = Form("balanced"),
    mode: str = Form("none"),
):
    """Transcribe audio with quality presets and mode processing."""
    global model, model_name, device_used

    audio_bytes = await file.read()

    # Guard: reject tiny recordings (likely accidental clicks)
    if len(audio_bytes) < 1024:
        return {"text": "", "language": "", "duration": 0, "skipped": "too_short"}

    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        lang = language if language and language != "auto" else None
        preset = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["balanced"])

        t0 = time.time()

        segments, info = model.transcribe(
            tmp_path,
            language=lang,
            beam_size=preset["beam_size"],
            best_of=preset["best_of"],
            temperature=preset["temperature"],
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 300,
                "speech_pad_ms": 200,
            },
            condition_on_previous_text=False,  # prevent hallucination loops
            no_speech_threshold=0.5,
            hallucination_silence_threshold=2.0,
            suppress_blank=True,
        )

        text = " ".join(seg.text for seg in segments).strip()
        elapsed = round(time.time() - t0, 2)

        # ── Mode Post-Processing ──
        if mode == "command" and text:
            text = process_voice_commands(text)

        return {
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
            "processing_time": elapsed,
            "quality": quality,
        }

    except RuntimeError as e:
        err = str(e)
        if "libcublas" in err or "cuda" in err.lower() or "cublas" in err.lower():
            print(f"⚠️  CUDA runtime error, FORCING CPU fallback: {err}")
            try:
                # Force CPU directly — do NOT call load_model() which tries CUDA first!
                model = WhisperModel(model_name, device="cpu", compute_type="int8")
                device_used = "cpu"
                print(f"✅ Forced CPU reload of '{model_name}'")
                # Retry transcription on CPU
                segments, info = model.transcribe(
                    tmp_path, language=lang, beam_size=3,
                    vad_filter=True, condition_on_previous_text=False,
                )
                text = " ".join(seg.text for seg in segments).strip()
                if mode == "command" and text:
                    text = process_voice_commands(text)
                return {"text": text, "language": info.language, "duration": round(info.duration, 2)}
            except Exception as e2:
                return JSONResponse(status_code=500, content={"error": f"CPU fallback failed: {e2}"})
        return JSONResponse(status_code=500, content={"error": err})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ── Voice Command Processing (Client-side primary, server fallback) ──

VOICE_COMMANDS = {
    r"\bnew line\b": "\n",
    r"\bnew paragraph\b": "\n\n",
    r"\bperiod\b": ".",
    r"\bfull stop\b": ".",
    r"\bcomma\b": ",",
    r"\bquestion mark\b": "?",
    r"\bexclamation mark\b": "!",
    r"\bexclamation point\b": "!",
    r"\bcolon\b": ":",
    r"\bsemicolon\b": ";",
    r"\bdash\b": "—",
    r"\bhyphen\b": "-",
    r"\bopen quote\b": '"',
    r"\bclose quote\b": '"',
    r"\bopen parenthesis\b": "(",
    r"\bclose parenthesis\b": ")",
}


def process_voice_commands(text: str) -> str:
    """Replace spoken punctuation/commands with actual characters."""
    result = text
    for pattern, replacement in VOICE_COMMANDS.items():
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    # Clean up extra spaces around punctuation
    result = re.sub(r'\s+([.,!?;:)\]])', r'\1', result)
    result = re.sub(r'([\[(])\s+', r'\1', result)
    return result.strip()


# ── Main ───────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)