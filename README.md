# MindMic Architecture 🎙️

MindMic is a decoupled enterprise voice-to-text pipeline that unifies lightning-fast local AI models with both native desktop and active web browsing experiences seamlessly.

## Ecosystem Breakdown

The architecture is explicitly split into three distinct micro-systems acting as a unified machine. The **Whisper_Server** acts as the central intelligence engine, while the **MindMic_Native** and **MindMic_Web_Extension** function as decoupled sensory endpoints linking back dynamically into the neural core.

### 1. [Whisper Server](./Whisper_Server)
The centralized FastAPI neural brain. Processes and transcribes raw mic payloads dynamically across local hardware.
* **Technology**: Python, FastAPI, Faster-Whisper, Native CTranslate2 C++ inference.
* **Architecture Base**: Built strictly against native Nvidia CUDA kernels dynamically pulling `.so` libraries strictly from the execution environment. We explicitly bypass massive intermediate layers like PyTorch, ensuring the fastest real-time translation loop available.

### 2. [MindMic Native Desktop](./MindMic_Native)
An enterprise-grade Linux daemon routing Wayland Wayback hooks tightly against a Javascript reactive front-end. It provides a transparent, draggable smart-dock that overlays over focused windows anywhere, giving you global dictation anywhere on your screen natively securely.
* **Technology**: Python Asyncio, GTK/AGS, Wayland, Native socket communication.

### 3. [MindMic Web Extension](./MindMic_Web_Extension)
A completely isolated local browser extension dynamically injecting floating dictation inputs over any webpage, specifically optimized against active contenteditable areas and chat-boxes. 
* **Technology**: Manifest V3, Web MediaRecorder API, Vanilla JS DOM shadowing.

---

## Universal Configuration 
Instead of hardcoding networks directly within code, this architecture utilizes `.env` execution variables globally.
Inside each modular root directory (`MindMic_Native`, `Whisper_Server`, and `MindMic_Web_Extension`), utilize the included `.env.example` to explicitly mount your required IP bindings if you intend to execute the AI on another machine dynamically or swap ports cleanly away from `127.0.0.1:8000`.

---

## Open Source Acknowledgments ⚓
MindMic stands directly upon incredible local open-source achievements making native architecture extremely fast and viable. Tremendous thanks to these repositories:
- **[Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)**: The optimized CTranslate2 execution foundation explicitly accelerating deep inference transcription speeds incredibly successfully over local CUDA nodes.
- **[Aylur's GTK Shell (AGS)](https://github.com/Aylur/ags)**: The phenomenal hardware-wayland desktop UI framework powering our pure native JS rendering overlay natively smoothly.
- **[FastAPI](https://github.com/tiangolo/fastapi)**: Powering our neural bridging websocket architectures routing local chunk loops dynamically against python.
- **[CTranslate2](https://github.com/OpenNMT/CTranslate2)**: Formally powering the absolute bleeding-edge inference weights decoupling us securely entirely away from massive backend constraints globally.
