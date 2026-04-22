/**
 * Blabby Voice — Background Service Worker
 * Routes ALL server communication + manages offscreen audio recording
 */

const SERVER = "http://127.0.0.1:8000";
let activeTabId = null;

// ─── Offscreen Document Management ───────────────────
async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record microphone audio for voice typing",
  });
}

// ─── Message Handler ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── From content script: start recording ──
  if (msg.action === "startRec") {
    activeTabId = sender.tab?.id ?? null;
    ensureOffscreen()
      .then(() => {
        chrome.runtime.sendMessage({ target: "offscreen", action: "startRec" });
      })
      .catch((err) => {
        console.error("[Blabby] Offscreen create failed:", err);
        if (activeTabId) {
          chrome.tabs.sendMessage(activeTabId, {
            action: "recError",
            error: "Failed to start audio capture: " + err.message,
          });
        }
      });
    sendResponse({ ok: true });
    return false;
  }

  // ── From content script: stop recording ──
  if (msg.action === "stopRec") {
    chrome.runtime
      .sendMessage({ target: "offscreen", action: "stopRec" })
      .catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  // ── From offscreen document ──
  if (msg.from === "offscreen") {
    if (msg.action === "recStarted" && activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { action: "recStarted" }).catch(() => {});
    }
    if (msg.action === "recError" && activeTabId) {
      chrome.tabs
        .sendMessage(activeTabId, { action: "recError", error: msg.error })
        .catch(() => {});
    }
    if (msg.action === "audioReady") {
      transcribeAudio(msg.dataUrl);
    }
    return false;
  }

  // ── Health check ──
  if (msg.action === "healthCheck") {
    fetch(SERVER + "/health", { method: "GET" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => sendResponse({ online: true, model: d.model, device: d.device }))
      .catch(() => sendResponse({ online: false }));
    return true; // async
  }

  // ── Transcription (from content script direct — legacy) ──
  if (msg.action === "transcribe") {
    (async () => {
      try {
        const res = await fetch(msg.audioDataUrl);
        const blob = await res.blob();
        const form = new FormData();
        form.append("file", blob, "audio.webm");
        if (msg.language && msg.language !== "auto") {
          form.append("language", msg.language);
        }
        const resp = await fetch(SERVER + "/transcribe", {
          method: "POST",
          body: form,
        });
        if (!resp.ok) throw new Error("Server " + resp.status);
        sendResponse(await resp.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Open settings in active tab ──
  if (msg.action === "openSettings") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "openSettings" }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ─── Transcribe audio from offscreen ──────────────────
async function transcribeAudio(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const form = new FormData();
    form.append("file", blob, "audio.webm");

    // Get language
    const data = await chrome.storage.local.get("blabby_language");
    const lang = data.blabby_language || "en";
    if (lang && lang !== "auto") form.append("language", lang);

    const resp = await fetch(SERVER + "/transcribe", {
      method: "POST",
      body: form,
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || "Server " + resp.status);
    }
    const result = await resp.json();

    if (activeTabId) {
      chrome.tabs
        .sendMessage(activeTabId, {
          action: "transcriptionResult",
          text: result.text,
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error("[Blabby] Transcription failed:", err);
    if (activeTabId) {
      chrome.tabs
        .sendMessage(activeTabId, {
          action: "transcriptionError",
          error: err.message,
        })
        .catch(() => {});
    }
  }
}

// ─── Chrome Command ───────────────────────────────────
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "toggle-dictation") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggle" }).catch(() => {});
      }
    });
  }
});

// ─── Defaults ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (d) => {
    const defs = {
      blabby_language: "en",
      blabby_appearance: "dot",
      blabby_auto_enter: false,
      blabby_shortcut: "Ctrl+Space",
      blabby_sound: { onStart: true, onStop: true },
    };
    const toSet = {};
    for (const [k, v] of Object.entries(defs)) {
      if (d[k] === undefined) toSet[k] = v;
    }
    if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
  });
});