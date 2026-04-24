/**
 * MindMic Voice — Offscreen Document
 * Handles getUserMedia + MediaRecorder in the extension context.
 * Supports mic device selection and audio level monitoring.
 */
let recorder = null;
let chunks = [];
let stream = null;
let analyserInterval = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.action === "startRec") {
    doStart(msg.deviceId || "default");
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

async function doStart(deviceId) {
  // Build audio constraints
  const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  // Apply specific device if not default
  if (deviceId && deviceId !== "default") {
    audioConstraints.deviceId = { exact: deviceId };
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
    });
    chunks = [];

    // ── Audio level monitoring ──
    try {
      const ac = new AudioContext();
      const source = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      analyserInterval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        // Compute RMS level 0-1
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length) / 255;
        chrome.runtime.sendMessage({
          from: "offscreen",
          action: "audioLevel",
          level: Math.min(1, rms * 2.5), // boost for visibility
        });
      }, 80); // ~12fps — smooth but lightweight
    } catch (_) {
      // Audio level monitoring is optional, don't block recording
    }

    // ── MediaRecorder ──
    let mime = "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      mime = "audio/webm;codecs=opus";
    }

    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      audioBitsPerSecond: 128000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      // Stop level monitoring
      clearInterval(analyserInterval);
      analyserInterval = null;

      // Release mic
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
    cleanup();
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
    cleanup();
    chrome.runtime.sendMessage({
      from: "offscreen",
      action: "recError",
      error: err.message,
    });
  }
}

function cleanup() {
  clearInterval(analyserInterval);
  analyserInterval = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  chunks = [];
}
