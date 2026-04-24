import gi
import os

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GtkLayerShell", "0.1")
gi.require_version("WebKit2", "4.1")

from gi.repository import Gtk, Gdk, GtkLayerShell, WebKit2


class MindMicOverlay(Gtk.Window):
    def __init__(self):
        super().__init__()

        GtkLayerShell.init_for_window(self)
        GtkLayerShell.set_layer(self, GtkLayerShell.Layer.OVERLAY)

        # Prevent focus stealing
        GtkLayerShell.set_keyboard_interactivity(self, False)

        # Anchor to bottom right
        GtkLayerShell.set_anchor(self, GtkLayerShell.Edge.BOTTOM, True)
        GtkLayerShell.set_anchor(self, GtkLayerShell.Edge.RIGHT, True)
        GtkLayerShell.set_margin(self, GtkLayerShell.Edge.BOTTOM, 20)
        GtkLayerShell.set_margin(self, GtkLayerShell.Edge.RIGHT, 20)

        # FIX 1: Force a default size so the window doesn't collapse to 0x0 pixels!
        # This creates a 400x150 invisible bounding box for your UI to render inside.
        self.set_default_size(400, 150)

        # Transparency
        self.set_visual(self.get_screen().get_rgba_visual())
        self.set_app_paintable(True)

        # WebKit Setup
        self.webview = WebKit2.WebView()
        self.webview.set_background_color(Gdk.RGBA(0, 0, 0, 0))

        settings = self.webview.get_settings()
        settings.set_enable_developer_extras(True)

        # FIX 2: Allow the local index.html to load style.css and app.js
        settings.set_allow_file_access_from_file_urls(True)
        settings.set_allow_universal_access_from_file_urls(True)

        self.add(self.webview)

        current_dir = os.path.dirname(os.path.abspath(__file__))
        index_path = os.path.join(current_dir, "web", "index.html")
        self.webview.load_uri(f"file://{index_path}")

        self.show_all()


if __name__ == "__main__":
    app = MindMicOverlay()
    Gtk.main()
