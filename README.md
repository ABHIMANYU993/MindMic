# MindMic Architecture 🎙️
MindMic is a decoupled enterprise voice-to-text pipeline that unifies lightning fast local AI models with both native desktop and active web browsing experiences simultaneously.

## Ecosystem Breakdown

The architecture is explicitly split into three distinct micro-systems seamlessly bridging over local WebSockets/TCP limits to form a completely fluid UX interaction point entirely relying on the `Whisper_Server` as the neural backend.

### [Whisper Server](./Whisper_Server)
The centralized FastAPI neural brain. Processes and transcribes raw mic payloads dynamically across local CUDA hardware models using smart fallback queues prioritizing raw processing speeds automatically mapping onto CPU integers when required.
* **Technology**: Python, FastAPI, Faster-Whisper, PyTorch.

### [MindMic Native Desktop](./MindMic_Native)
An enterprise-grade native Python daemon routing native Wayland Linux hooks against a Javascript purely-reactive widget front-end. Provides a globally transparent sliding dock hovering independently against all windows enabling instant global dictation securely without disrupting desktop streams.
* **Technology**: Python Asyncio, GTK/AGS, Wayland, Native GDK Shell mapping.

### [MindMic Web Extension](./MindMic_Web_Extension)
A completely isolated local browser extension dynamically injecting floating recording inputs exclusively onto active inputs or chat windows across any tab! Connects seamlessly against the same unified Whisper neural node. 
* **Technology**: Manifest V3, Sandboxed Environment Modules, Vanilla Fetch logic.

---

## Universal Configuration 
Instead of hardcoding ports locally throughout individual instances, the architecture leverages aggressive structural `.env` loading.
Within the root of **each** application block, simply trace the provided `.env.example` file specifically building an explicit `.env` layout setting up your desired IP address configurations if they drift from the standard `127.0.0.1:8000` mapping schema!
