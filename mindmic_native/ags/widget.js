import Widget from "resource:///com/github/Aylur/ags/widget.js";
import MindMic from "./service.js";
import App from "resource:///com/github/Aylur/ags/app.js";
import Gtk from "gi://Gtk?version=3.0";

// --- MAIN BAR COMPONENTS ---
const Waveform = () =>
  Widget.Box({
    class_name: "wave",
    visible: MindMic.bind("state").as((s) => s === "recording"),
    children: Array.from({ length: 5 }, (_, i) =>
      Widget.Box({
        class_name: "wave-bar",
        vpack: "center",
        setup: (self) =>
          self.hook(
            MindMic,
            () => {
              const offset = Math.sin(Date.now() / 150 + i * 1.7) * 0.3 + 0.7;
              const h = Math.max(4, MindMic.level * offset * 24);
              self.css = `min-height: ${h}px;`;
            },
            "notify::level",
          ),
      }),
    ),
  });

const Spinner = () =>
  Widget.Box({
    class_name: "spin",
    visible: MindMic.bind("state").as((s) => s === "transcribing"),
    children: [".", ".", "."].map((d) =>
      Widget.Label({ class_name: "spin-d", label: d }),
    ),
  });

// Interactive Mode Toggle Button
const ModeItem = (label, modeId, icon) =>
  Widget.Button({
    class_name: MindMic.bind("mode").as((m) =>
      m === modeId ? "mi active" : "mi",
    ),
    on_clicked: () => {
      MindMic.mode = modeId;
      MindMic.menu_open = false;
    },
    child: Widget.Box({
      spacing: 10,
      children: [
        Widget.Label({ class_name: "mi-ico", label: icon }),
        Widget.Label({ label: label, xalign: 0, hexpand: true }),
        Widget.Label({
          label: MindMic.bind("mode").as((m) => (m === modeId ? "✓" : "")),
          class_name: "mi-check",
        }),
      ],
    }),
  });

const SubMenu = () =>
  Widget.Revealer({
    reveal_child: MindMic.bind("menu-open"),
    transition: "slide_up",
    child: Widget.Box({
      class_name: "menu-box",
      vertical: true,
      children: [
        ModeItem("No mode", "none", "⊘"),
        ModeItem("Punctuation", "punctuation", "✦"),
        ModeItem("Commands", "command", "⌘"),
        Widget.Box({ class_name: "sep" }),
        Widget.Button({
          class_name: "mi",
          on_clicked: () => MindMic.openSettings(),
          child: Widget.Box({
            spacing: 10,
            children: [
              Widget.Label("⚙"),
              Widget.Label({ label: "Settings", xalign: 0, hexpand: true }),
            ],
          }),
        }),
      ],
    }),
  });

const Bar = () =>
  Widget.EventBox({
    on_hover: () => {
      if (MindMic.state === "idle" && MindMic._visibility_mode === "glassy")
        MindMic.state = "expanded";
    },
    on_hover_lost: () => {
      if (MindMic.state === "expanded") {
        setTimeout(() => {
          if (MindMic.state === "expanded" && !MindMic.menu_open)
            MindMic.state = "idle";
        }, 900);
      }
    },
    child: Widget.Box({
      class_name: MindMic.bind("state").as((s) =>
        MindMic._visibility_mode === "ephemeral" && s === "idle"
          ? "bar expanded"
          : `bar ${s}`,
      ),
      children: [
        Widget.Box({
          class_name: "items",
          children: [
            Widget.Label({ class_name: "lang", label: "en" }),
            Widget.Button({
              class_name: "btn mic",
              visible: MindMic.bind("state").as(
                (s) => s !== "recording" && s !== "transcribing",
              ),
              on_clicked: () => MindMic.toggleRecording(),
              child: Widget.Icon("audio-input-microphone-symbolic"),
            }),
            Widget.Button({
              class_name: "btn stop",
              visible: MindMic.bind("state").as((s) => s === "recording"),
              on_clicked: () => MindMic.toggleRecording(),
              child: Widget.Icon("media-playback-stop-symbolic"),
            }),
            Waveform(),
            Spinner(),
            Widget.Button({
              class_name: "btn",
              visible: MindMic.bind("state").as(
                (s) => s !== "recording" && s !== "transcribing",
              ),
              on_clicked: () => (MindMic.menu_open = !MindMic.menu_open),
              child: Widget.Label("⋯"),
            }),
            Widget.Button({
              class_name: "btn sm",
              on_clicked: () => {
                MindMic.state = "idle";
                MindMic.show_ui = false;
              },
              child: Widget.Label("✕"),
            }),
          ],
        }),
      ],
    }),
  });

export const MindMicOverlay = () =>
  Widget.Window({
    name: "mindmic",
    class_name: "mindmic-window",
    anchor: ["bottom", "right"],
    margins: [0, 20, 20, 0],
    layer: "overlay",
    exclusivity: "ignore",
    keymode: "none", // Bar cannot steal focus
    visible: MindMic.bind("show-ui"),
    child: Widget.Box({
      vertical: true,
      hpack: "end",
      vpack: "end",
      spacing: 8,
      children: [SubMenu(), Bar()],
    }),
  });

// --- SETTINGS WINDOW COMPONENTS ---
const SettingsTabBtn = (id, icon, label) =>
  Widget.Button({
    class_name: MindMic.bind("settings-tab").as((t) =>
      t === id ? "s-tab active" : "s-tab",
    ),
    on_clicked: () => (MindMic.settings_tab = id),
    child: Widget.Box({
      spacing: 10,
      children: [Widget.Label(icon), Widget.Label(label)],
    }),
  });

const SettingsSidebar = () =>
  Widget.Box({
    class_name: "s-sidebar",
    vertical: true,
    children: [
      Widget.Box({
        class_name: "s-logo",
        children: [Widget.Label("🎙️ MindMic")],
      }),
      SettingsTabBtn("general", "⚙", "General"),
      SettingsTabBtn("transcription", "🎤", "Transcription"),
      SettingsTabBtn("shortcut", "⌨", "Shortcut"),
      SettingsTabBtn("languages", "🌐", "Languages"),
      SettingsTabBtn("modes", "✧", "Modes"),
      SettingsTabBtn("appearance", "🎨", "Appearance"),
      SettingsTabBtn("sound", "🔊", "Sound"),
      Widget.Box({ vexpand: true }), // Spacer
      Widget.Box({ class_name: "sep" }),
      Widget.Button({
        class_name: "s-foot-btn",
        child: Widget.Label("💡 Feature request"),
      }),
      Widget.Button({
        class_name: "s-foot-btn",
        child: Widget.Label("🐛 Report a Bug"),
      }),
    ],
  });

// Example of the General Tab Content
const GeneralTab = () =>
  Widget.Box({
    vertical: true,
    class_name: "s-content",
    children: [
      Widget.Label({ label: "General", class_name: "s-title", xalign: 0 }),
      Widget.Label({
        label: "Configure general extension behavior.",
        class_name: "s-sub",
        xalign: 0,
      }),
      // Fake toggle row for visual setup
      Widget.Box({
        class_name: "trow",
        children: [
          Widget.Box({
            vertical: true,
            hexpand: true,
            children: [
              Widget.Label({
                label: "Auto-enter after transcription",
                class_name: "trow-l",
                xalign: 0,
              }),
              Widget.Label({
                label: "Press Enter automatically after inserting text.",
                class_name: "trow-h",
                xalign: 0,
              }),
            ],
          }),
          Widget.Switch({ 
              active: MindMic.bind("auto_enter"),
              on_activate: ({active}) => MindMic.auto_enter = active 
          }),
        ],
      }),
      DropdownRow("Transcription Speed", "quality", [
          {id: "balanced", name: "Balanced (beam=3) — recommended"},
          {id: "fast", name: "Fast (beam=1)"},
          {id: "best", name: "Best (beam=5)"}
      ]),
      Widget.Box({
          class_name: "card",
          children: [
              Widget.Label("🟢 Server: Online · Model: " + MindMic.model + " · GPU")
          ]
      })
    ],
  });

const DropdownRow = (label, bindKey, options) => Widget.Box({
  class_name: "trow",
  children: [
    Widget.Box({
       vertical: true,
       hexpand: true,
       children: [Widget.Label({ label, class_name: "trow-l", xalign: 0 })]
    }),
    Widget.Box({
      setup: (self) => {
        const cb = new Gtk.ComboBoxText();
        options.forEach(o => cb.append(o.id, o.name));
        cb.active_id = MindMic[bindKey] || options[0].id;
        cb.connect("changed", () => {
           MindMic[bindKey] = cb.get_active_id();
        });
        MindMic.connect(`notify::${bindKey}`, () => {
           cb.set_active_id(MindMic[bindKey]);
        });
        self.child = cb;
      }
    })
  ]
});

const ModeRadio = (name, desc, modeId) => Widget.Button({
  class_name: MindMic.bind("mode").as(m => m === modeId ? "m-rad active" : "m-rad"),
  on_clicked: () => MindMic.mode = modeId,
  child: Widget.Box({
    spacing: 12,
    children: [
      Widget.Label({ class_name: "rad-indicator", label: MindMic.bind("mode").as(m => m === modeId ? "◉" : "○") }),
      Widget.Box({
        vertical: true,
        children: [
          Widget.Label({ label: name, class_name: "m-rad-title", xalign: 0 }),
          Widget.Label({ label: desc, class_name: "m-rad-desc", xalign: 0 })
        ]
      })
    ]
  })
});

const TranscriptionTab = () => Widget.Box({
  vertical: true, class_name: "s-content",
  children: [
    Widget.Label({ label: "Transcription", class_name: "s-title", xalign: 0 }),
    Widget.Label({ label: "Configure transcription settings and microphone device.", class_name: "s-sub", xalign: 0 }),
    DropdownRow("Microphone Device", "mic_device", [{id: "default", name: "Default"}]),
    DropdownRow("Transcription Model", "model", [
        {id: "large-v3-turbo", name: "Whisper Large v3 Turbo (fastest, high accuracy)"},
        {id: "large-v3", name: "Whisper Large v3 (slow, highest accuracy)"},
        {id: "medium", name: "Whisper Medium"},
        {id: "small", name: "Whisper Small"},
        {id: "base", name: "Whisper Base"}
    ]),
    DropdownRow("Max Recording Duration", "max_recording", [{id: "300", name: "5 minutes (default)"}]),
  ]
});

const LanguagesTab = () => Widget.Box({
  vertical: true, class_name: "s-content",
  children: [
    Widget.Label({ label: "Languages", class_name: "s-title", xalign: 0 }),
    DropdownRow("Spoken Language", "language", [
        {id: "auto", name: "Auto-detect (Recommended)"},
        {id: "en", name: "English"},
        {id: "es", name: "Spanish"},
        {id: "fr", name: "French"}
    ]),
  ]
});

const ModesTab = () => Widget.Box({
  vertical: true, class_name: "s-content",
  spacing: 10,
  children: [
    Widget.Label({ label: "Modes", class_name: "s-title", xalign: 0 }),
    Widget.Label({ label: "Choose a transcription mode.", class_name: "s-sub", xalign: 0 }),
    ModeRadio("No mode", "Default transcription without any special processing.", "none"),
    ModeRadio("Punctuation", "Whisper auto-adds punctuation. Best for dictation.", "punctuation"),
    ModeRadio("Command", 'Voice commands: say "new line", "period", "comma", "question mark", "delete", etc.', "command"),
  ]
});

const DummyTab = (name) => Widget.Box({
  vertical: true, class_name: "s-content",
  children: [Widget.Label({ label: name, class_name: "s-title", xalign: 0 })]
});

// Stack to swap between tabs
const SettingsContent = () =>
  Widget.Stack({
    transition: "crossfade",
    shown: MindMic.bind("settings-tab"),
    children: {
      general: GeneralTab(),
      transcription: TranscriptionTab(),
      shortcut: DummyTab("Shortcut"),
      languages: LanguagesTab(),
      modes: ModesTab(),
      appearance: DummyTab("Appearance"),
      sound: DummyTab("Sound"),
    },
  });

export const MindMicSettingsWindow = () =>
  Widget.Window({
    name: "mindmic-settings",
    class_name: "settings-window",
    anchor: [], // Center of screen (no anchors)
    layer: "top",
    keymode: "exclusive", // Settings window CAN steal focus so you can type in it
    visible: false, // Hidden by default
    child: Widget.Box({
      class_name: "s-panel",
      children: [
        SettingsSidebar(),
        Widget.Box({
          vertical: true,
          hexpand: true,
          children: [
            Widget.Button({
              class_name: "s-close",
              hpack: "end",
              label: "✕",
              on_clicked: () => App.closeWindow("mindmic-settings"),
            }),
            SettingsContent(),
          ],
        }),
      ],
    }),
  });
