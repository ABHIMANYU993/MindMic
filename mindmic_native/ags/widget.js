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
    vpack: "center",
    visible: MindMic.bind("state").as((s) => s === "transcribing"),
    children: [1, 2, 3].map((i) =>
      Widget.Box({ class_name: `spin-d d${i}` }),
    ),
  });

// Removed SubMenu and Settings as requested

const Bar = () =>
  Widget.EventBox({
    on_hover: () => {
      if (MindMic.state === "idle" && MindMic._visibility_mode === "glassy")
        MindMic.state = "expanded";
    },
    on_hover_lost: () => {
      if (MindMic.state === "expanded") {
        setTimeout(() => {
          if (MindMic.state === "expanded")
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
      children: [Bar()],
    }),
  });


