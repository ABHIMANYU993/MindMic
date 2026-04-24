/**
 * MindMic Voice — Background Service Worker
 * Routes ALL server communication + manages offscreen audio recording
 * Every setting wired end-to-end
 */

// ── Config ────────────────────────────────────────────
let DEFAULT_SERVER = "http://127.0.0.1:8000";
let activeTabId = null;
let offscreenCloser = null; // timer to auto-close offscreen

/**
 * Loads environmental variables defined via local `.env` overriding standard default paths dynamically.
 */
async function loadEnvConfig() {
  try {
    const url = chrome.runtime.getURL(".env");
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      text.split("\n").forEach(line => {
        if (line.includes("=") && !line.trim().startsWith("#")) {
          const [key, ...rest] = line.split("=");
          if (key.trim() === "WHISPER_URL") {
            DEFAULT_SERVER = rest.join("=").trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
          }
        }
      });
    }
  } catch (e) {
    console.warn("[MindMic] Environment map warning: Unable to parse .env correctly.", e);
  }
}
// Execute instantly at boot priority
loadEnvConfig();

/**
 * Resolves the current local GPU processing endpoint extracting from local cache or environment file.
 * @returns {Promise<string>} 
 */
async function getServerUrl() {
  const d = await chrome.storage.local.get("mindmic_server_url");
  return d.mindmic_server_url || DEFAULT_SERVER;
}

// ── Offscreen Document Management ─────────────────────
/**
 * Safely initializes the background invisible web-portal unlocking mic stream capabilities dynamically.
 */
async function ensureOffscreen() {
  clearTimeout(offscreenCloser);
  const exists = await chrome.offscreen.hasDocument();
  if (exists) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record microphone audio for voice typing",
  });
}

/**
 * Configures the silent shutdown cleanup cycle avoiding browser background processing lockouts natively.
 */
function scheduleOffscreenClose() {
  clearTimeout(offscreenCloser);
  offscreenCloser = setTimeout(async () => {
    try {
      const exists = await chrome.offscreen.hasDocument();
      if (exists) await chrome.offscreen.closeDocument();
    } catch (_) {}
  }, 60000); // close after 60s of inactivity
}

// ── Message Handler ───────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── Start recording ──
  if (msg.action === "startRec") {
    activeTabId = sender.tab?.id ?? null;
    ensureOffscreen()
      .then(() => {
        // Forward mic device ID if specified
        chrome.runtime.sendMessage({
          target: "offscreen",
          action: "startRec",
          deviceId: msg.deviceId || "default",
        });
      })
      .catch((err) => {
        console.error("[MindMic] Offscreen create failed:", err);
        if (activeTabId) {
          chrome.tabs
            .sendMessage(activeTabId, {
              action: "recError",
              error: "Failed to start audio capture: " + err.message,
            })
            .catch(() => {});
        }
      });
    sendResponse({ ok: true });
    return false;
  }

  // ── Stop recording ──
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
      chrome.tabs
        .sendMessage(activeTabId, { action: "recStarted" })
        .catch(() => {});
    }
    if (msg.action === "recError" && activeTabId) {
      chrome.tabs
        .sendMessage(activeTabId, { action: "recError", error: msg.error })
        .catch(() => {});
    }
    if (msg.action === "audioLevel" && activeTabId) {
      chrome.tabs
        .sendMessage(activeTabId, { action: "audioLevel", level: msg.level })
        .catch(() => {});
    }
    if (msg.action === "audioReady") {
      transcribeAudio(msg.dataUrl);
      scheduleOffscreenClose();
    }
    return false;
  }

  // ── Health check ──
  if (msg.action === "healthCheck") {
    (async () => {
      try {
        const srv = await getServerUrl();
        const r = await fetch(srv + "/health", { method: "GET" });
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        sendResponse({
          online: true,
          model: d.model,
          device: d.device,
          loading: d.loading,
        });
      } catch {
        sendResponse({ online: false });
      }
    })();
    return true;
  }

  // ── List models ──
  if (msg.action === "listModels") {
    (async () => {
      try {
        const srv = await getServerUrl();
        const r = await fetch(srv + "/models");
        if (!r.ok) throw new Error(r.status);
        sendResponse(await r.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Change model ──
  if (msg.action === "changeModel") {
    (async () => {
      try {
        const srv = await getServerUrl();
        const r = await fetch(srv + "/model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: msg.model }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || "Server " + r.status);
        }
        const result = await r.json();
        // Save chosen model
        chrome.storage.local.set({ mindmic_model: msg.model });
        sendResponse(result);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  // ── Legacy direct transcribe (from content script) ──
  if (msg.action === "transcribe") {
    (async () => {
      try {
        const srv = await getServerUrl();
        const res = await fetch(msg.audioDataUrl);
        const blob = await res.blob();
        const form = new FormData();
        form.append("file", blob, "audio.webm");
        if (msg.language && msg.language !== "auto")
          form.append("language", msg.language);
        const resp = await fetch(srv + "/transcribe", {
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
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "openSettings" })
          .catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ── Transcribe audio from offscreen ───────────────────
/**
 * Routes chunks of isolated base audio array streams backwards towards the defined Whisper container handling timeouts.
 * 
 * @param {string} dataUrl Base64 Blob pointer extracted explicitly from recording sequences.
 */
async function transcribeAudio(dataUrl) {
  // Read all settings
  const data = await chrome.storage.local.get([
    "mindmic_language",
    "mindmic_quality",
    "mindmic_mode",
    "mindmic_auto_enter",
    "mindmic_site_settings",
    "mindmic_server_url",
  ]);

  const srv = data.mindmic_server_url || DEFAULT_SERVER;
  const lang = data.mindmic_language || "en";
  const quality = data.mindmic_quality || "balanced";
  const mode = data.mindmic_mode || "none";
  const globalAutoEnter = data.mindmic_auto_enter || false;

  // Check per-site auto-enter
  let autoEnter = globalAutoEnter;
  if (activeTabId) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        const host = new URL(tab.url).hostname;
        const ss = data.mindmic_site_settings || {};
        if (ss[host] !== undefined) autoEnter = ss[host];
      }
    } catch (_) {}
  }

  // Retry logic with exponential backoff
  const MAX_RETRIES = 3;
  const BACKOFF = [500, 1000, 2000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const form = new FormData();
      form.append("file", blob, "audio.webm");
      if (lang && lang !== "auto") form.append("language", lang);
      form.append("quality", quality);
      form.append("mode", mode);

      const resp = await fetch(srv + "/transcribe", {
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
            autoEnter: autoEnter,
            language: result.language,
            duration: result.duration,
            processingTime: result.processing_time,
          })
          .catch(() => {});
      }
      return; // success
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.warn(
          `[MindMic] Transcription attempt ${attempt + 1} failed, retrying in ${BACKOFF[attempt]}ms:`,
          err.message
        );
        await new Promise((r) => setTimeout(r, BACKOFF[attempt]));
      } else {
        console.error("[MindMic] Transcription failed after retries:", err);
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
  }
}

// ── Chrome Command ────────────────────────────────────
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "toggle-dictation") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "toggle" })
          .catch(() => {});
      }
    });
  }
});

// ── Defaults on Install ──────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (d) => {
    const defs = {
      mindmic_language: "en",
      mindmic_languages: ["en"],
      mindmic_appearance: "dot",
      mindmic_auto_enter: false,
      mindmic_shortcut: "Ctrl+Space",
      mindmic_sound: { onStart: true, onStop: true },
      mindmic_mode: "none",
      mindmic_model: "large-v3-turbo",
      mindmic_quality: "balanced",
      mindmic_mic_device: "default",
      mindmic_server_url: DEFAULT_SERVER,
      mindmic_max_recording: 300,
      mindmic_site_settings: {},
    };
    const toSet = {};
    for (const [k, v] of Object.entries(defs)) {
      if (d[k] === undefined) toSet[k] = v;
    }
    if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
  });
});