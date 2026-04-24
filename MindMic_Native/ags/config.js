import App from "resource:///com/github/Aylur/ags/app.js";
import { MindMicOverlay } from "./widget.js";

App.config({
  style: App.configDir + "/style.css",
  windows: [MindMicOverlay()],
});
