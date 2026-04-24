import Service from "resource:///com/github/Aylur/ags/service.js";
import * as Utils from "resource:///com/github/Aylur/ags/utils.js";
import App from "resource:///com/github/Aylur/ags/app.js";

class MindMicService extends Service {
  static {
    Service.register(
      this,
      {},
      {
        state: ["string", "rw"],
        level: ["float", "r"],
        "show-ui": ["boolean", "rw"],
      },
    );
  }

  _state = "idle";
  _level = 0.0;
  _visibility_mode = "glassy";
  _show_ui = true;
  _hideTimer = null;

  get state() {
    return this._state;
  }
  get level() {
    return this._level;
  }
  get show_ui() {
    return this._show_ui;
  }

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
  toggleRecording() {
    const pythonPath = "/home/icebyte/Projects/Personal/Web-Dev/voice_web_extension/mindmic_native/.venv/bin/python";
    const cliPath = "/home/icebyte/Projects/Personal/Web-Dev/voice_web_extension/mindmic_native/cli.py";
    Utils.execAsync([pythonPath, cliPath, "toggle_retained"]);
  }

  constructor() {
    super();
    this._startBridge();
  }

  _startBridge() {
    const pythonPath =
      "/home/icebyte/Projects/Personal/Web-Dev/voice_web_extension/mindmic_native/.venv/bin/python";
    const bridgePath =
      "/home/icebyte/Projects/Personal/Web-Dev/voice_web_extension/mindmic_native/bridge.py";
    Utils.subprocess([pythonPath, bridgePath], (output) =>
      this._handleMessage(output),
    );
  }

  _handleMessage(output) {
    try {
      const data = JSON.parse(output);
      if (data.action === "state") {
        this.state = data.status;
        this._visibility_mode = data.visibility || "glassy";

        if (this._hideTimer) {
          clearTimeout(this._hideTimer);
          this._hideTimer = null;
        }

        if (this._visibility_mode === "ephemeral") {
          if (this.state === "idle") {
            this._hideTimer = setTimeout(() => {
              this.show_ui = false;
            }, 3000);
          } else {
            this.show_ui = true;
          }
        } else {
          this.show_ui = true;
        }
      } else if (data.action === "audioLevel") {
        this._level = data.level;
        this.changed("level");
      }
    } catch (e) {}
  }


}

export default new MindMicService();
