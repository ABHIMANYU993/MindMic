import Service from "resource:///com/github/Aylur/ags/service.js";
import * as Utils from "resource:///com/github/Aylur/ags/utils.js";
import App from "resource:///com/github/Aylur/ags/app.js";

// Native dot env loader avoiding external NPM modules via Aylur file utils
const ENV = {};
try {
  const envContent = Utils.readFile(`${App.configDir}/../.env`);
  envContent.split('\n').forEach(line => {
    if (line && line.includes('=') && !line.trim().startsWith('#')) {
      const [key, ...rest] = line.split('=');
      ENV[key.trim()] = rest.join('=').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }
  });
} catch (e) {
  console.log("[MindMic] Warning: Unable to parse parent .env file securely.");
}

const PYTHON_BIN = ENV["PYTHON_BIN"] || "/usr/bin/python3";
const CLI_PATH = ENV["CLI_PATH"] || "cli.py";
const DAEMON_HOST = ENV["DAEMON_HOST"] || "127.0.0.1";
const AGS_TCP_PORT = parseInt(ENV["AGS_TCP_PORT"]) || 8765;

/**
 * Enterprise Native AGS Service Bridge
 * 
 * Tracks central variables for UI modes, background daemon bindings, 
 * active volume states for waveform processing, and reactive window margin constraints.
 */
class MindMicService extends Service {
  /**
   * Registers reactive property bindings readable by native GTK/AGS components.
   * @static
   */
  static {
    Service.register(
      this,
      {
        audioLevel: ["float"],
      },
      {
        state: ["string", "rw"],
        level: ["float", "r"],
        "show-ui": ["boolean", "rw"],
        "margin-right": ["int", "rw"],
        "margin-bottom": ["int", "rw"],
      },
    );
  }

  // Private state defaults
  _state = "idle";
  _level = 0.0;
  _visibility_mode = "glassy";
  _show_ui = false;
  _margin_right = 20;
  _margin_bottom = 20;

  // --- Getters ---

  get state() { return this._state; }
  get level() { return this._level; }
  get show_ui() { return this._show_ui; }
  get margin_right() { return this._margin_right; }
  get margin_bottom() { return this._margin_bottom; }

  // --- Setters ---

  set state(value) {
    if (this._state !== value) {
      this._state = value;
      this.changed("state");
    }
  }
  set show_ui(value) {
    if (this._show_ui !== value) {
      this._show_ui = value;
      this.changed("show-ui");
    }
  }
  set margin_right(value) {
    if (this._margin_right !== value) {
      this._margin_right = Math.max(0, value); // Ensure it does not float off screen
      this.changed("margin-right");
    }
  }
  set margin_bottom(value) {
    if (this._margin_bottom !== value) {
      this._margin_bottom = Math.max(0, value);
      this.changed("margin-bottom");
    }
  }

  /**
   * Invokes the system CLI trigger to dynamically shift the background Python daemon
   * out of its idling state or vice-versa.
   */
  toggleRecording() {
    Utils.execAsync([PYTHON_BIN, CLI_PATH, "toggle_retained"]);
  }

  /**
   * Adjusts the current floating margins against specific numeric deltas.
   * 
   * @param {number} dx Delta shift across the X-axis pointer grid.
   * @param {number} dy Delta shift across the Y-axis pointer grid.
   */
  shiftPosition(dx, dy) {
    // Note: Due to right/bottom anchoring, drifting rightwards (dx > 0) reduces margin.
    this.margin_right -= dx;
    this.margin_bottom -= dy;
  }

  /**
   * Directly reverses positional drift bounds resetting against the factory 20px layout.
   */
  resetPosition() {
    this.margin_right = 20;
    this.margin_bottom = 20;
  }

  constructor() {
    super();
    this._startBridge();
  }

  /**
   * Internal bridge connection sequence syncing pure backend WebSockets over 127.0.0.1:8765
   * into dynamic mapped Service properties continuously.
   */
  _startBridge() {
    const Gio = imports.gi.Gio;
    const client = new Gio.SocketClient();
    try {
      const connection = client.connect_to_host(DAEMON_HOST, AGS_TCP_PORT, null);
      if (!connection) return;

      const istream = connection.get_input_stream();
      const dstream = new Gio.DataInputStream({ base_stream: istream });

      const readLoop = () => {
        dstream.read_line_async(0, null, (stream, res) => {
          try {
            const [line] = stream.read_line_finish(res);
            if (line) {
              const data = JSON.parse(imports.byteArray.toString(line));
              if (data.action === "audioLevel") {
                this._level = data.level;
                this.changed("level");
                this.emit("audioLevel", this._level);
              } else if (data.action === "state") {
                this._visibility_mode = data.visibility;
                this.state = data.status;
                if (data.visibility === "ephemeral" && data.status === "idle") {
                  setTimeout(() => {
                    if (this._visibility_mode === "ephemeral" && this.state === "idle") {
                      this.show_ui = false;
                    }
                  }, 800);
                } else if (data.status === "recording" || data.status === "transcribing") {
                  this.show_ui = true;
                }
              }
              readLoop();
            } else {
              Utils.timeout(2000, () => this._startBridge());
            }
          } catch (e) {
            Utils.timeout(2000, () => this._startBridge());
          }
        });
      };
      readLoop();
    } catch (e) { }
  }
}

export default new MindMicService();
