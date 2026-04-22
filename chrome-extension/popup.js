// Blabby Voice — Popup Script (external file, CSP-safe)

async function checkServer() {
  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusLabel");
  const detail = document.getElementById("statusDetail");
  try {
    const resp = await chrome.runtime.sendMessage({ action: "healthCheck" });
    if (resp && resp.online) {
      dot.classList.add("on");
      label.textContent = "Server Online";
      detail.textContent =
        "Model: " + (resp.model || "whisper") + " • http://127.0.0.1:8000";
    } else {
      throw new Error();
    }
  } catch {
    dot.classList.remove("on");
    label.textContent = "Server Offline";
    detail.textContent = "Start: cd whisper-server && python server.py";
  }
}

checkServer();

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "openSettings" });
  window.close();
});
