import App from "resource:///com/github/Aylur/ags/app.js";
import { MindMicOverlay, MindMicSettingsWindow } from "./widget.js";

App.config({
  style: App.configDir + "/style.css",
  windows: [MindMicOverlay(), MindMicSettingsWindow()],
});
