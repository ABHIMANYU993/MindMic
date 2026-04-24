# MindMic Native Desktop

The enterprise Linux system daemon seamlessly intertwining local Wayland Waypoints over active neural connections globally! 
This component functions as an always-ambient desktop widget hooking directly over native TCP into the Whisper Server handling high-speed typing instantly overriding any active graphical window seamlessly.

## Visual Design Options
The structural aesthetics natively parse the AGS Javascript GTK layers executing purely natively avoiding QWebEngine memory bloats entirely pulling sleek, hardware transparent blur and hover effects dynamically. The UI is completely draggable across the entire desktop rendering and will intuitively pop a quick `reset` locator binding perfectly to corner constraints over the monitor seamlessly.

## System Dependencies
Before setting up the virtual environment, guarantee your Linux distribution has the following native libraries installed (via your respective package manager such as `pacman`, `apt`, or `dnf`):
- `wtype` (Required for native Wayland text injection mapping directly against cursor positions).
- `gtk-layer-shell` (Required for rendering transparent floating GTK widgets over other active Wayland programs natively).
- `webkit2gtk-6.0` (Core WebKit GTK rendering libraries).
- `gobject-introspection` (Required for dynamically bridging core C/GTK signals to Python and JS).
- `portaudio` (Required base library underlying `PyAudio` mic capturing loops).

## Configuration & Usage
Ensure you configure all internal pointers mapped via the local `.env` setup pointing backwards toward `.venv` wrappers.
```bash
cd MindMic_Native
cp .env.example .env
# Open .env and ensure PYTHON_BIN array maps cleanly.
```

### Hyprland Bindings (Autorun Configuration)
For pure dynamic execution bridging natively on Linux desktops, set a user environment variable export (e.g., `$MindMic_Native`) pointing to your installation path, then inject these bindings gracefully into your `hyprland.conf`:

```ini
# --- MindMic Native Background Services ---
# 1. Start the Python audio/websocket daemon silently
exec-once = $MindMic_Native/.venv/bin/python $MindMic_Native/daemon.py > /dev/null 2>&1 &

# 2. Start the AGS UI (with a 1-second delay so the Python socket has time to bind)
exec-once = sleep 1 && ags -b mindmic -c $MindMic_Native/ags/config.js > /dev/null 2>&1 &

# Mode 1: Quick Phantom Mode (Disappears after 3s)
bind = SUPER, M, exec, $MindMic_Native/.venv/bin/python $MindMic_Native/cli.py quick

# Mode 2: Retained Glassy Mode (Stays in corner as a dot)
bind = SUPER CTRL, M, exec, $MindMic_Native/.venv/bin/python $MindMic_Native/cli.py retained
```
