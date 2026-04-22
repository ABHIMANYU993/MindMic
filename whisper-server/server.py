from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel
import uvicorn
import tempfile
import os
import sys

# Fix CUDA library path — find libcublas.so.12 in known locations
_cuda_search = [
    os.path.expanduser("~/.pyenv/versions/3.12.9/lib/python3.12/site-packages/nvidia/cublas/lib"),
    os.path.expanduser("~/.pyenv/versions/3.11.9/lib/python3.11/site-packages/nvidia/cublas/lib"),
    "/usr/local/cuda/lib64",
    "/opt/cuda/lib64",
]
for _p in _cuda_search:
    if os.path.isdir(_p):
        os.environ["LD_LIBRARY_PATH"] = _p + ":" + os.environ.get("LD_LIBRARY_PATH", "")
        # Also search for cudnn, cufft, etc.
        _nvidia_base = os.path.dirname(os.path.dirname(_p))
        for _subdir in os.listdir(_nvidia_base) if os.path.isdir(_nvidia_base) else []:
            _lib = os.path.join(_nvidia_base, _subdir, "lib")
            if os.path.isdir(_lib):
                os.environ["LD_LIBRARY_PATH"] = _lib + ":" + os.environ.get("LD_LIBRARY_PATH", "")
        break

# Also handle ctypes path
import ctypes.util

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load model with CUDA → CPU fallback ──
model = None
device_used = "loading"

def load_model():
    global model, device_used
    # Try CUDA first
    try:
        model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
        device_used = "cuda"
        print("✅ Model loaded on CUDA (GPU)")
        # Test inference to catch runtime CUDA errors early
        return
    except Exception as e:
        print(f"⚠️  CUDA load failed: {e}")

    # Fallback to CPU
    try:
        model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
        device_used = "cpu"
        print("✅ Model loaded on CPU (int8)")
    except Exception as e:
        print(f"⚠️  large-v3-turbo CPU failed: {e}")
        try:
            model = WhisperModel("base", device="cpu", compute_type="int8")
            device_used = "cpu-base"
            print("✅ Fallback: base model on CPU")
        except Exception as e2:
            print(f"❌ All model loads failed: {e2}")
            sys.exit(1)

load_model()

@app.get("/health")
async def health():
    return {"status": "ok", "model": "large-v3-turbo", "device": device_used}

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = None):
    global model, device_used

    audio_bytes = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        lang = language if language and language != "auto" else None
        segments, info = model.transcribe(
            tmp_path, language=lang, beam_size=5, vad_filter=True
        )
        text = " ".join(segment.text for segment in segments)
        return {
            "text": text.strip(),
            "language": info.language,
            "duration": round(info.duration, 2),
        }
    except RuntimeError as e:
        err_msg = str(e)
        if "libcublas" in err_msg or "CUDA" in err_msg.upper() or "cublas" in err_msg:
            print(f"⚠️  CUDA runtime error, switching to CPU: {err_msg}")
            try:
                model = WhisperModel(
                    "large-v3-turbo", device="cpu", compute_type="int8"
                )
                device_used = "cpu"
                print("✅ Reloaded on CPU")
                # Retry transcription
                segments, info = model.transcribe(
                    tmp_path, language=lang, beam_size=5, vad_filter=True
                )
                text = " ".join(segment.text for segment in segments)
                return {
                    "text": text.strip(),
                    "language": info.language,
                    "duration": round(info.duration, 2),
                }
            except Exception as e2:
                return JSONResponse(
                    status_code=500,
                    content={"error": f"CPU fallback failed: {e2}"},
                )
        return JSONResponse(status_code=500, content={"error": err_msg})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)