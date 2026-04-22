/**
 * Blabby Voice — Offscreen Document
 * Handles getUserMedia + MediaRecorder in the extension context.
 * This bypasses any site CSP that blocks microphone access in content scripts.
 */
let recorder = null;
let chunks = [];
let stream = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.action === "startRec") {
    doStart();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === "stopRec") {
    doStop();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function doStart() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];

    let mime = "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      mime = "audio/webm;codecs=opus";
    }

    recorder = new MediaRecorder(stream, { mimeType: mime });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;

      const blob = new Blob(chunks, { type: mime });
      chunks = [];

      const reader = new FileReader();
      reader.onloadend = () => {
        chrome.runtime.sendMessage({
          from: "offscreen",
          action: "audioReady",
          dataUrl: reader.result,
        });
      };
      reader.readAsDataURL(blob);
    };

    recorder.start(250);
    chrome.runtime.sendMessage({ from: "offscreen", action: "recStarted" });
  } catch (err) {
    chrome.runtime.sendMessage({
      from: "offscreen",
      action: "recError",
      error: err.message,
    });
  }
}

function doStop() {
  try {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    chrome.runtime.sendMessage({
      from: "offscreen",
      action: "recError",
      error: err.message,
    });
  }
}
