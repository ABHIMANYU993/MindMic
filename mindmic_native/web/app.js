const bar = document.getElementById("bar");
const micBtn = document.getElementById("micBtn");
const stopBtn = document.getElementById("stopBtn");
const wave = document.getElementById("wave");
const spin = document.getElementById("spin");
const dotsBtn = document.getElementById("dotsBtn");
const waveBars = document.querySelectorAll(".wave-bar");

let currentState = "idle";

// Connect to Python Daemon
const ws = new WebSocket("ws://127.0.0.1:8765");

ws.onopen = () => console.log("Connected to MindMic Native Daemon");

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.action === "state") {
    setUI(data.status);
  } else if (data.action === "audioLevel") {
    updateWaveform(data.level);
  }
};

function setUI(state) {
  currentState = state;
  bar.className = "bar " + state;

  if (state === "idle") {
    // Optional: you can change this to "expanded" if you want it to default to the full pill
    bar.className = "bar idle";
  }

  micBtn.classList.toggle(
    "hide",
    state === "recording" || state === "transcribing",
  );
  stopBtn.classList.toggle("hide", state !== "recording");
  wave.classList.toggle("hide", state !== "recording");
  spin.classList.toggle("hide", state !== "transcribing");
  dotsBtn.classList.toggle(
    "hide",
    state === "recording" || state === "transcribing",
  );
}

function updateWaveform(level) {
  waveBars.forEach((b, i) => {
    // pseudo-random offset identical to extension logic
    const offset = Math.sin(Date.now() / 150 + i * 1.7) * 0.3 + 0.7;
    const h = Math.max(4, level * offset * 24);
    b.style.height = h + "px";
  });
}

// Mouse interaction for the UI
bar.addEventListener("mouseenter", () => {
  if (currentState === "idle") setUI("expanded");
});

bar.addEventListener("mouseleave", () => {
  // Return to idle dot if we leave and we aren't recording/processing
  if (currentState === "expanded") {
    setTimeout(() => {
      if (currentState === "expanded") setUI("idle");
    }, 900);
  }
});
