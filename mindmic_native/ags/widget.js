import Widget from "resource:///com/github/Aylur/ags/widget.js";
import MindMic from "./service.js";
import App from "resource:///com/github/Aylur/ags/app.js";
import Gtk from "gi://Gtk?version=3.0";
import Gdk from "gi://Gdk?version=3.0";

/**
 * Renders the reactive waveform visualizer utilizing sine offset mathematics
 * alongside real RMS audio levels fetched iteratively from the MindMic service.
 * 
 * @returns {import('resource:///com/github/Aylur/ags/widgets/box.js').default} Waveform layout element.
 */
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

/**
 * Animated processing indicator looping 3 independent styled dot boxes during 
 * background HTTP transcription operations.
 * 
 * @returns {import('resource:///com/github/Aylur/ags/widgets/box.js').default} Animated Spinner instance.
 */
const Spinner = () =>
  Widget.Box({
    class_name: "spin",
    vpack: "center",
    visible: MindMic.bind("state").as((s) => s === "transcribing"),
    children: [1, 2, 3].map((i) =>
      Widget.Box({ class_name: `spin-d d${i}` }),
    ),
  });

/**
 * Global functional interface overlay controlling the active daemon context.
 * Serves as a transparent draggable wrapper utilizing low-level pointer tracking.
 * 
 * @returns {import('resource:///com/github/Aylur/ags/widgets/eventbox.js').default} Event context handler embedding interactions.
 */
const Bar = () => {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  return Widget.EventBox({
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
    setup: (self) => {
      self.add_events(
        Gdk.EventMask.POINTER_MOTION_MASK |
        Gdk.EventMask.BUTTON_PRESS_MASK |
        Gdk.EventMask.BUTTON_RELEASE_MASK
      );
      
      self.on("button-press-event", (widget, event) => {
        const [_, button] = event.get_button();
        if (button === 1) { // L-Click activates Drag routine
          dragging = true;
          const [__, rootX, rootY] = event.get_root_coords();
          offsetX = rootX;
          offsetY = rootY;
        }
        return false; // Propagate down to UI buttons
      });
      
      self.on("button-release-event", () => {
        dragging = false; 
        return false; // Propagate click releases
      });
      
      self.on("motion-notify-event", (widget, event) => {
        if (!dragging) return false;
        const [_, rootX, rootY] = event.get_root_coords();
        const dx = rootX - offsetX;
        const dy = rootY - offsetY;
        offsetX = rootX;
        offsetY = rootY;
        
        MindMic.shiftPosition(dx, dy);
        return false;
      });
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

            // Dynamic Reset Widget strictly visible upon layout deviation
            Widget.Button({
              class_name: "btn sm",
              setup: (self) => {
                const updateResetVis = () => {
                  self.visible = (MindMic.margin_right !== 20 || MindMic.margin_bottom !== 20);
                };
                self.hook(MindMic, updateResetVis, "notify::margin-right");
                self.hook(MindMic, updateResetVis, "notify::margin-bottom");
              },
              on_clicked: () => MindMic.resetPosition(),
              child: Widget.Label("⟲"),
            }),

            // Immediate Termination exit
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
};

/**
 * Singleton Base Window Layer injected globally against Hyprland desktop compositors.
 * Maintains explicit margin hooks directly intercepting service-propagated structural changes.
 * 
 * @returns {import('resource:///com/github/Aylur/ags/widgets/window.js').default} Constructed Window instance.
 */
export const MindMicOverlay = () =>
  Widget.Window({
    name: "mindmic",
    class_name: "mindmic-window",
    anchor: ["bottom", "right"],
    layer: "overlay",
    exclusivity: "ignore",
    keymode: "none", // Prevent underlying focus interception constraints
    visible: MindMic.bind("show-ui"),
    child: Widget.Box({
      vertical: true,
      hpack: "end",
      vpack: "end",
      spacing: 8,
      setup: (self) => {
        // Shift constraints purely via GTK CSS properties bypassing deprecated Window constraints.
        const updateMargins = () => {
          self.css = `margin-right: ${MindMic.margin_right}px; margin-bottom: ${MindMic.margin_bottom}px;`;
        };
        self.hook(MindMic, updateMargins, "notify::margin-right");
        self.hook(MindMic, updateMargins, "notify::margin-bottom");
        updateMargins();
      },
      children: [Bar()],
    }),
  });


