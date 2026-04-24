// MindMic Voice — Popup Script (external file, CSP-safe)

async function init() {
  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusLabel");
  const detail = document.getElementById("statusDetail");
  const keysEl = document.getElementById("shortcutKeys");

  // Check server
  try {
    const sStore = await chrome.storage.local.get("mindmic_server_url");
    const activeUrl = sStore.mindmic_server_url || "http://127.0.0.1:8000";

    const resp = await chrome.runtime.sendMessage({ action: "healthCheck" });
    if (resp && resp.online) {
      dot.classList.add("on");
      label.textContent = "Server Online";
      detail.textContent =
        "Model: " + (resp.model || "whisper") +
        " · " + (resp.device || "gpu") +
        " · " + activeUrl;
    } else {
      throw new Error();
    }
  } catch {
    dot.classList.remove("on");
    label.textContent = "Server Offline";
    detail.textContent = "Start: cd Whisper_Server && python server.py";
  }

  // Load shortcut
  try {
    const d = await chrome.storage.local.get("mindmic_shortcut");
    const sc = d.mindmic_shortcut || "Ctrl+Space";
    keysEl.innerHTML = "";
    sc.split("+").forEach((k) => {
      const span = document.createElement("span");
      span.className = "key";
      span.textContent = k;
      keysEl.appendChild(span);
    });
  } catch {}
}

init();

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "openSettings" });
  window.close();
});
