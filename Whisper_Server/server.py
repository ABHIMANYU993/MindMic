from typing import Dict, List, Any, Optional
import os
# Configure PyTorch caching allocator to automatically manage fragmentation and limit VRAM accumulation without manual empty_cache crashes
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "garbage_collection_threshold:0.10,max_split_size_mb:128,expandable_segments:True"
import sys
import re
import time
import tempfile
import argparse
import soundfile as sf
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# Initialize environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# Parse command line arguments
def parse_args():
    parser = argparse.ArgumentParser(description="MindMic Whisper Server V2")
    parser.add_argument("-m", "-M", "--model", "--model-name", type=str, default=None, help="Model to load: parakeet or distil-whisper")
    parser.add_argument("--host", type=str, default=None, help="Host to bind")
    parser.add_argument("--port", type=int, default=None, help="Port to bind")
    args, unknown = parser.parse_known_args()
    return args

args = parse_args()

# Determine model to load: argparse -> env variable -> default "parakeet"
selected_model_type = "parakeet"
env_model = os.getenv("WHISPER_MODEL") or os.getenv("MODEL_NAME") or os.getenv("MODEL")
if env_model:
    if "distil" in env_model.lower() or "whisper" in env_model.lower():
        selected_model_type = "distil-whisper"
    else:
        selected_model_type = "parakeet"

if args.model:
    if "distil" in args.model.lower() or "whisper" in args.model.lower():
        selected_model_type = "distil-whisper"
    else:
        selected_model_type = "parakeet"

SERVER_HOST: str = args.host or os.getenv("HOST", "127.0.0.1")
SERVER_PORT: int = int(args.port or os.getenv("PORT", "8000"))

# ── App ────────────────────────────────────────────────
app = FastAPI(title="MindMic Voice Server V2", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Model Manager ─────────────────────────────────────
model = None
model_name = selected_model_type
device_used = "cpu"
model_loading = False

# Prompt to enforce proper transcription format, casing, and spacing for Distil-Whisper
INITIAL_PROMPT = (
    "Maintain high-quality transcription with perfect spelling, proper casing, "
    "correct spacing, and complete punctuation (including commas, periods, colons, "
    "semicolons, question marks, and exclamation marks). Do not ignore any spoken words."
)

def load_model(model_type: str) -> None:
    global model, model_name, device_used, model_loading
    model_loading = True
    try:
        import torch
        # Disable cuDNN to prevent CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH errors with conflicting virtual environment/system cuDNN libraries
        torch.backends.cudnn.enabled = False
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        device_used = device
        
        if model_type == "distil-whisper":
            from faster_whisper import WhisperModel
            # Use FP16 on GPU, INT8 on CPU to stay under VRAM
            compute_type = "float16" if device == "cuda" else "int8"
            print(f"Loading Distil-Whisper model on {device} ({compute_type})...")
            model = WhisperModel("Systran/faster-distil-whisper-large-v3", device=device, compute_type=compute_type)
            model_name = "distil-whisper"
            print("✅ Distil-Whisper model loaded successfully!")
        else:
            # Load NVIDIA Parakeet model
            print(f"Loading NVIDIA Parakeet model (parakeet-tdt-0.6b-v3) on {device}...")
            import nemo.collections.asr as nemo_asr
            model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
            if device == "cuda":
                model = model.half().cuda()
            model.eval()
            model_name = "parakeet"
            print("✅ NVIDIA Parakeet model loaded successfully!")
    except Exception as e:
        print(f"❌ Failed to load model '{model_type}': {e}")
        # Fallback to CPU loading if CUDA fails
        if model_type == "distil-whisper":
            try:
                from faster_whisper import WhisperModel
                print("Falling back to CPU INT8 for Distil-Whisper...")
                model = WhisperModel("Systran/faster-distil-whisper-large-v3", device="cpu", compute_type="int8")
                device_used = "cpu"
                model_name = "distil-whisper"
                print("✅ Distil-Whisper loaded on CPU fallback.")
            except Exception as ex:
                print(f"❌ Fallback failed: {ex}")
                sys.exit(1)
        else:
            try:
                print("Falling back to CPU for NVIDIA Parakeet...")
                import nemo.collections.asr as nemo_asr
                model = nemo_asr.models.ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")
                model.eval()
                device_used = "cpu"
                model_name = "parakeet"
                print("✅ NVIDIA Parakeet loaded on CPU fallback.")
            except Exception as ex:
                print(f"❌ Fallback failed: {ex}")
                sys.exit(1)
    finally:
        model_loading = False

# Load the selected model on startup
load_model(selected_model_type)

# Fix startup 6.1GB VRAM spike by forcibly purging initialization buffers
import gc
import torch
if torch.cuda.is_available():
    gc.collect()
    torch.cuda.empty_cache()

# ── Simple VAD (Silence Detection) ──
def is_silent(audio_path: str, threshold: float = 0.005) -> bool:
    """
    Check if the audio file is silent using energy thresholding.
    Helps prevent transcribing empty clicks or background hums.
    """
    try:
        data, samplerate = sf.read(audio_path)
        if len(data) == 0:
            return True
        rms = np.sqrt(np.mean(data**2))
        return rms < threshold
    except Exception:
        return False  # Transcribe if VAD check fails

# ── Audio Preprocessing via FFmpeg ──
def preprocess_audio(input_path: str) -> str:
    """
    Converts any input audio file to a 16kHz mono WAV file
    using ffmpeg, which is required by NeMo and Whisper.
    """
    out_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    out_path = out_file.name
    out_file.close()
    
    try:
        import subprocess
        # Convert to 16kHz, mono, 16-bit PCM WAV
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
            "-ar", "16000", "-ac", "1",
            "-acodec", "pcm_s16le", out_path
        ]
        # Run ffmpeg, suppressing output
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return out_path
    except Exception as e:
        print(f"⚠️  ffmpeg preprocessing failed: {e}")
        return input_path

# ── Endpoints ──────────────────────────────────────────

@app.get("/health")
async def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "model": model_name,
        "device": device_used,
        "loading": model_loading,
    }

@app.get("/models")
async def list_models() -> Dict[str, Any]:
    return {
        "models": [
            {
                "id": "parakeet",
                "name": "NVIDIA Parakeet (TDT 0.6B)",
                "params": "600M",
                "speed": "fastest",
                "accuracy": "very_high",
                "active": model_name == "parakeet"
            },
            {
                "id": "distil-whisper",
                "name": "Distil-Whisper Large v3",
                "params": "756M",
                "speed": "fast",
                "accuracy": "high",
                "active": model_name == "distil-whisper"
            }
        ],
        "active": model_name,
        "device": device_used
    }

@app.post("/model")
async def change_model(body: Dict[str, str]) -> Any:
    new_model: str = body.get("model", "").strip().lower()
    if not new_model:
        return JSONResponse(status_code=400, content={"error": "Model name cannot be empty"})
    
    target_type = "distil-whisper" if "distil" in new_model or "whisper" in new_model else "parakeet"
    
    if target_type == model_name and not model_loading:
        return {"status": "already_loaded", "model": model_name, "device": device_used}
        
    try:
        load_model(target_type)
        return {"status": "loaded", "model": model_name, "device": device_used}
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Failed to load: {str(e)}"})

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    quality: str = Form("balanced"),
    mode: str = Form("none"),
) -> Any:
    global model, model_name, device_used
    
    audio_bytes = await file.read()
    if len(audio_bytes) < 1024:
        return {"text": "", "language": "en", "duration": 0, "skipped": "too_short"}
        
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
        
    wav_path = None
    try:
        # Preprocess using FFmpeg to 16kHz mono WAV
        wav_path = preprocess_audio(tmp_path)
        
        # Get duration using soundfile
        audio_info = sf.info(wav_path)
        duration = round(audio_info.duration, 2)
        
        # Simple VAD guard
        if is_silent(wav_path):
            return {"text": "", "language": "en", "duration": duration, "skipped": "silent"}
            
        t0 = time.time()
        
        if model_name == "distil-whisper":
            # Distil-Whisper inference
            segments, info = model.transcribe(
                wav_path,
                language="en",
                beam_size=5,
                vad_filter=True,
                initial_prompt=INITIAL_PROMPT,
            )
            text = " ".join(seg.text for seg in segments).strip()
            detected_lang = info.language
        else:
            # NVIDIA Parakeet enterprise-grade inference with chunking
            chunk_duration = 35.0 # 35 seconds hard cap for strict 1.5GB-1.7GB VRAM limit
            
            if duration <= chunk_duration:
                import torch
                with torch.no_grad():
                    transcriptions = model.transcribe([wav_path], batch_size=1, num_workers=0)
                if isinstance(transcriptions, list) and len(transcriptions) > 0:
                    res = transcriptions[0]
                    text = res.text.strip() if hasattr(res, "text") else str(res).strip()
                else:
                    text = ""
            else:
                import numpy as np
                import torch
                
                chunk_paths = []
                data, sr = sf.read(wav_path)
                
                max_chunk_samples = int(chunk_duration * sr)
                search_window_samples = int(10.0 * sr) 
                silence_window_samples = int(0.2 * sr)
                step = int(0.05 * sr)
                
                current_start = 0
                total_samples = len(data)
                
                try:
                    while current_start < total_samples:
                        remaining = total_samples - current_start
                        if remaining <= max_chunk_samples:
                            end = total_samples
                        else:
                            search_start = max(current_start + max_chunk_samples - search_window_samples, current_start + silence_window_samples)
                            search_end = current_start + max_chunk_samples
                            
                            best_split = search_end
                            min_energy = float('inf')
                            
                            for w_start in range(search_start, search_end - silence_window_samples, step):
                                window = data[w_start : w_start + silence_window_samples]
                                energy = np.mean(window**2)
                                if energy < min_energy:
                                    min_energy = energy
                                    best_split = w_start + (silence_window_samples // 2)
                                    
                            end = best_split
                            
                        chunk_data = data[current_start:end]
                        fd, temp_path = tempfile.mkstemp(suffix=".wav")
                        os.close(fd)
                        sf.write(temp_path, chunk_data, sr)
                        chunk_paths.append(temp_path)
                        
                        current_start = end
                    
                    texts = []
                    # Process sequentially strictly dropping references
                    for p in chunk_paths:
                        with torch.no_grad():
                            res_list = model.transcribe([p], batch_size=1, num_workers=0)
                        if isinstance(res_list, list) and len(res_list) > 0:
                            res = res_list[0]
                            t = res.text.strip() if hasattr(res, "text") else str(res).strip()
                            if t:
                                texts.append(t)
                            del res
                        del res_list
                                
                    text = " ".join(texts).strip()
                finally:
                    import gc
                    gc.collect()
                    # Bulletproof cleanup of all chunks even on crash
                    for p in chunk_paths:
                        try:
                            if os.path.exists(p):
                                os.unlink(p)
                        except OSError:
                            pass
                            
            detected_lang = "en"
            
        elapsed = round(time.time() - t0, 2)
        
        # ── Mode Post-Processing ──
        if mode == "command" and text:
            text = process_voice_commands(text)
            
        # Capitalization & formatting
        text = clean_formatting_and_capitalization(text)
        
        return {
            "text": text,
            "language": detected_lang,
            "duration": duration,
            "processing_time": elapsed,
            "quality": quality,
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        # Cleanup temporary files
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if wav_path and wav_path != tmp_path:
            try:
                os.unlink(wav_path)
            except OSError:
                pass

# ── Voice Command Processing ──

VOICE_COMMAND_MAPPING = [
    (r"\bnew\s*paragraphs?\b", "\n\n"),
    (r"\bnew\s*lines?\b", "\n"),
    (r"\bnext\s*lines?\b", "\n"),
    (r"\bperiods?\b", "."),
    (r"\bfull\s*stops?\b", "."),
    (r"\bcommas?\b", ","),
    (r"\bquestion\s*marks?\b", "?"),
    (r"\bexclamation\s*(marks?|points?)\b", "!"),
    (r"\bcolons?\b", ":"),
    (r"\bsemicolons?\b", ";"),
    (r"\bdashes?\b", "—"),
    (r"\bhyphens?\b", "-"),
    (r"\b(open|start)\s*quotes?\b", '"'),
    (r"\b(close|end)\s*quotes?\b", '"'),
    (r"\bopen\s*(parenthes(is|es)|brackets?)\b", "("),
    (r"\bclose\s*(parenthes(is|es)|brackets?)\b", ")"),
]

def capitalize_sentences(text: str) -> str:
    if not text:
        return text
    chars = list(text)
    capitalize_next = True
    for i in range(len(chars)):
        if capitalize_next and chars[i].isalpha():
            chars[i] = chars[i].upper()
            capitalize_next = False
        elif chars[i] in ['.', '!', '?']:
            if i + 1 == len(chars) or chars[i+1].isspace() or chars[i+1] in ['"', ')']:
                capitalize_next = True
        elif chars[i] == '\n':
            capitalize_next = True
    return "".join(chars)

def clean_formatting_and_capitalization(text: str) -> str:
    if not text:
        return text
    result = text
    result = re.sub(r"\s+([.,!?;:)\]])", r"\1", result)
    result = re.sub(r"([\[(])\s+", r"\1", result)
    result = re.sub(r"\(\s*([^)]+?)\s*\)", r"(\1)", result)
    result = re.sub(r'\s*"\s*([^"]+?)\s*"\s*', r' " \1 " ', result)
    result = re.sub(r'\s*"\s*([^"]+?)\s*"\s*', r' "\1" ', result)
    result = re.sub(r" +", " ", result)
    result = capitalize_sentences(result)
    
    # Line breaks cleanup
    lines = result.split('\n')
    cleaned_lines = [line.strip() for line in lines]
    result = '\n'.join(cleaned_lines)
    result = re.sub(r"\n{3,}", "\n\n", result)
    result = capitalize_sentences(result)
    return result.strip()

def process_voice_commands(text: str) -> str:
    if not text:
        return text
    result = text
    for pattern, replacement in VOICE_COMMAND_MAPPING:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result

if __name__ == "__main__":
    print(f"Spinning up Uvicorn V2 tied against {SERVER_HOST}:{SERVER_PORT}")
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT)
