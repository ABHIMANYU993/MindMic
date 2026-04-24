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
        "menu-open": ["boolean", "rw"],
        mode: ["string", "rw"],
        "settings-tab": ["string", "rw"],
        quality: ["string", "rw"],
        language: ["string", "rw"],
        model: ["string", "rw"],
        "auto-enter": ["boolean", "rw"],
        "mic-device": ["string", "rw"],
        "max-recording": ["string", "rw"],
      },
    );
  }

  _state = "idle";
  _level = 0.0;
  _visibility_mode = "glassy";
  _show_ui = true;
  _menu_open = false;
  _mode = "none"; // none, punctuation, command
  _settings_tab = "general";
  _quality = "balanced";
  _language = "auto";
  _model = "large-v3-turbo";
  _auto_enter = false;
  _mic_device = "default";
  _max_recording = "300";
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
  get menu_open() {
    return this._menu_open;
  }
  get mode() {
    return this._mode;
  }
  get settings_tab() {
    return this._settings_tab;
  }
  get quality() {
    return this._quality;
  }
  get language() {
    return this._language;
  }
  get model() {
    return this._model;
  }
  get auto_enter() {
    return this._auto_enter;
  }
  get mic_device() {
    return this._mic_device;
  }
  get max_recording() {
    return this._max_recording;
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
  set menu_open(value) {
    if (this._menu_open !== value) {
      this._menu_open = value;
      this.changed("menu-open");
    }
  }
  set mode(value) {
    if (this._mode !== value) {
      this._mode = value;
      this.changed("mode");
      this._sendCmd({ action: "update_setting", key: "mode", value });
    }
  }
  set settings_tab(value) {
    if (this._settings_tab !== value) {
      this._settings_tab = value;
      this.changed("settings-tab");
    }
  }
  set quality(value) {
    if (this._quality !== value) {
      this._quality = value;
      this.changed("quality");
      this._sendCmd({ action: "update_setting", key: "quality", value });
    }
  }
  set language(value) {
    if (this._language !== value) {
      this._language = value;
      this.changed("language");
      this._sendCmd({ action: "update_setting", key: "language", value });
    }
  }
  set model(value) {
    if (this._model !== value) {
      this._model = value;
      this.changed("model");
      this._sendCmd({ action: "update_setting", key: "model", value });
    }
  }
  set auto_enter(value) {
    if (this._auto_enter !== value) {
      this._auto_enter = value;
      this.changed("auto-enter");
      this._sendCmd({ action: "update_setting", key: "auto_enter", value });
    }
  }
  set mic_device(value) {
    if (this._mic_device !== value) {
      this._mic_device = value;
      this.changed("mic-device");
      this._sendCmd({ action: "update_setting", key: "mic_device", value });
    }
  }
  set max_recording(value) {
    if (this._max_recording !== value) {
      this._max_recording = value;
      this.changed("max-recording");
      this._sendCmd({ action: "update_setting", key: "max_recording", value });
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
    this._fetchSettings();
  }

  _sendCmd(payload) {
    const pythonPath = "/home/icebyte/Projects/Personal/Web-Dev/voice_web_extension/mindmic_native/.venv/bin/python";
    const cliPath = "/home/icebyte/Projects/Personal/Web-Dev/voice_web_extension/mindmic_native/cli.py";
    return Utils.execAsync([pythonPath, cliPath, JSON.stringify(payload)])
      .then(out => JSON.parse(out))
      .catch(err => {
        console.error(err);
        return { error: err.message || err };
      });
  }

  _fetchSettings() {
    this._sendCmd({ action: "get_settings" }).then(conf => {
      if (!conf.error) {
        if (conf.mode) { this._mode = conf.mode; this.changed("mode"); }
        if (conf.quality) { this._quality = conf.quality; this.changed("quality"); }
        if (conf.language) { this._language = conf.language; this.changed("language"); }
        if (conf.model) { this._model = conf.model; this.changed("model"); }
        if (conf.auto_enter !== undefined) { this._auto_enter = conf.auto_enter; this.changed("auto-enter"); }
        if (conf.mic_device) { this._mic_device = conf.mic_device; this.changed("mic-device"); }
        if (conf.max_recording) { this._max_recording = conf.max_recording; this.changed("max-recording"); }
      }
    });
  }

  async getModels() {
    return await this._sendCmd({ action: "get_models" });
  }

  async changeModel(modelId) {
    return await this._sendCmd({ action: "set_model", model: modelId });
  }

  async checkHealth() {
    return await this._sendCmd({ action: "health" });
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

  openSettings() {
    this.menu_open = false;
    App.openWindow("mindmic-settings");
  }
}

export default new MindMicService();
