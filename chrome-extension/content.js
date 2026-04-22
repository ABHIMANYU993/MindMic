/**
 * Blabby Voice — Content Script v2.0
 * Production-ready floating overlay · Every setting wired · Shadow DOM isolated
 * Recording via offscreen document (works on ALL sites)
 */
(function () {
  "use strict";
  if (document.getElementById("blabby-voice-root")) return;

  /* ══════════════════════════════════════════════════════
     1. STORAGE KEYS & STATE
     ══════════════════════════════════════════════════════ */
  const SK = {
    position: "blabby_position",
    language: "blabby_language",
    languages: "blabby_languages",
    appearance: "blabby_appearance",
    autoEnter: "blabby_auto_enter",
    shortcut: "blabby_shortcut",
    sound: "blabby_sound",
    mode: "blabby_mode",
    model: "blabby_model",
    quality: "blabby_quality",
    micDevice: "blabby_mic_device",
    serverUrl: "blabby_server_url",
    siteSettings: "blabby_site_settings",
    maxRecording: "blabby_max_recording",
  };

  const state = {
    visible: false,
    ui: "idle", // idle | expanded | recording | transcribing
    recording: false,
    transcribing: false,
    serverOnline: false,
    // Settings (synced with storage)
    language: "en",
    languages: ["en"],
    shortcut: "Ctrl+Space",
    autoEnter: false,
    sound: { onStart: true, onStop: true },
    appearance: "dot", // dot | visible | hidden | minimal
    mode: "none", // none | punctuation | command
    model: "large-v3-turbo",
    quality: "balanced",
    micDevice: "default",
    maxRecording: 300,
    // UI state
    dragging: false,
    dragMoved: false,
    dragOffset: { x: 0, y: 0 },
    lastInput: null,
    savedRange: null,
    savedCursor: { s: 0, e: 0 },
    settingsTab: "general",
    siteAutoEnter: false,
    shortcutListening: false,
    pos: { x: 100, y: 300 },
    audioLevel: 0,
    recStartTime: 0,
    modelLoading: false,
  };

  /* ══════════════════════════════════════════════════════
     2. SETTINGS LOAD/SAVE
     ══════════════════════════════════════════════════════ */
  function loadSettings() {
    return new Promise((r) => {
      if (!chrome?.storage?.local) return r();
      chrome.storage.local.get(Object.values(SK), (d) => {
        if (d[SK.position]) state.pos = d[SK.position];
        if (d[SK.language]) state.language = d[SK.language];
        if (d[SK.languages]) state.languages = d[SK.languages];
        if (d[SK.appearance]) state.appearance = d[SK.appearance];
        if (d[SK.autoEnter] !== undefined) state.autoEnter = d[SK.autoEnter];
        if (d[SK.shortcut]) state.shortcut = d[SK.shortcut];
        if (d[SK.sound]) state.sound = d[SK.sound];
        if (d[SK.mode]) state.mode = d[SK.mode];
        if (d[SK.model]) state.model = d[SK.model];
        if (d[SK.quality]) state.quality = d[SK.quality];
        if (d[SK.micDevice]) state.micDevice = d[SK.micDevice];
        if (d[SK.maxRecording]) state.maxRecording = d[SK.maxRecording];
        const host = location.hostname;
        const ss = d[SK.siteSettings] || {};
        if (ss[host] !== undefined) state.siteAutoEnter = ss[host];
        r();
      });
    });
  }

  function save(k, v) {
    chrome?.storage?.local?.set({ [k]: v });
  }

  /* ══════════════════════════════════════════════════════
     3. HELPERS
     ══════════════════════════════════════════════════════ */
  function isInput(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      return ["text", "email", "search", "url", "tel", "password", ""].includes(t);
    }
    return false;
  }

  function saveCursor() {
    const el = state.lastInput;
    if (!el) return;
    try {
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) state.savedRange = sel.getRangeAt(0).cloneRange();
      } else {
        state.savedCursor = { s: el.selectionStart ?? 0, e: el.selectionEnd ?? 0 };
      }
    } catch (_) {}
  }

  function restoreCursor() {
    const el = state.lastInput;
    if (!el) return;
    try {
      if (el.isContentEditable) {
        el.focus();
        if (state.savedRange) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(state.savedRange);
        }
      } else {
        el.focus();
        el.setSelectionRange(state.savedCursor.s, state.savedCursor.e);
      }
    } catch (_) {}
  }

  function playSound(type) {
    if (type === "start" && !state.sound.onStart) return;
    if (type === "stop" && !state.sound.onStop) return;
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g);
      g.connect(c.destination);
      o.type = "sine";
      if (type === "start") {
        o.frequency.setValueAtTime(600, c.currentTime);
        o.frequency.linearRampToValueAtTime(900, c.currentTime + 0.1);
      } else {
        o.frequency.setValueAtTime(900, c.currentTime);
        o.frequency.linearRampToValueAtTime(500, c.currentTime + 0.15);
      }
      g.gain.setValueAtTime(0.06, c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + 0.15);
      o.start();
      o.stop(c.currentTime + 0.2);
      setTimeout(() => c.close().catch(() => {}), 500);
    } catch (_) {}
  }

  /* ══════════════════════════════════════════════════════
     4. VOICE COMMAND PROCESSING (client-side, fast)
     ══════════════════════════════════════════════════════ */
  const VOICE_CMDS = [
    [/\bnew line\b/gi, "\n"],
    [/\bnew paragraph\b/gi, "\n\n"],
    [/\bperiod\b/gi, "."],
    [/\bfull stop\b/gi, "."],
    [/\bcomma\b/gi, ","],
    [/\bquestion mark\b/gi, "?"],
    [/\bexclamation mark\b/gi, "!"],
    [/\bexclamation point\b/gi, "!"],
    [/\bcolon\b/gi, ":"],
    [/\bsemicolon\b/gi, ";"],
    [/\bdash\b/gi, "—"],
    [/\bhyphen\b/gi, "-"],
    [/\bopen quote\b/gi, '"'],
    [/\bclose quote\b/gi, '"'],
    [/\bopen parenthesis\b/gi, "("],
    [/\bclose parenthesis\b/gi, ")"],
    [/\bspace\b/gi, " "],
    [/\btab\b/gi, "\t"],
  ];

  function processVoiceCommands(text) {
    let r = text;
    for (const [re, rep] of VOICE_CMDS) r = r.replace(re, rep);
    r = r.replace(/\s+([.,!?;:)\]])/g, "$1");
    r = r.replace(/([\[(])\s+/g, "$1");
    return r.trim();
  }

  /* ══════════════════════════════════════════════════════
     5. AUTO-ENTER — Smart Mode
     ══════════════════════════════════════════════════════ */
  const SEND_SELECTORS = {
    "chat.openai.com": '[data-testid="send-button"], button[aria-label="Send prompt"]',
    "chatgpt.com": '[data-testid="send-button"], button[aria-label="Send prompt"]',
    "gemini.google.com": 'button[aria-label="Send message"], button.send-button',
    "grok.com": 'button[aria-label="Send"], button[aria-label="Submit"]',
    "chat.deepseek.com": 'div[class*="send"] button, button[class*="send"]',
  };

  function isChat() {
    const h = location.hostname;
    return Object.keys(SEND_SELECTORS).some((k) => h.includes(k));
  }

  function doAutoEnter() {
    const el = state.lastInput;
    if (!el) return;
    const host = location.hostname;

    // Try site-specific send button
    for (const [domain, sel] of Object.entries(SEND_SELECTORS)) {
      if (host.includes(domain)) {
        // Small delay to let UI react to text insertion
        setTimeout(() => {
          const btn = document.querySelector(sel);
          if (btn) {
            btn.click();
            return;
          }
          // Fallback: dispatch Enter key
          dispatchEnterKey(el);
        }, 150);
        return;
      }
    }

    // Generic: only auto-enter on chat-like sites, not search/editors
    if (el.isContentEditable || el.tagName === "TEXTAREA") {
      setTimeout(() => dispatchEnterKey(el), 100);
    }
  }

  function dispatchEnterKey(el) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  /* ══════════════════════════════════════════════════════
     6. SHADOW DOM
     ══════════════════════════════════════════════════════ */
  const hostEl = document.createElement("div");
  hostEl.id = "blabby-voice-root";
  document.documentElement.appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: "closed" });

  const css = document.createElement("style");
  css.textContent = getCSS();
  shadow.appendChild(css);

  /* ══════════════════════════════════════════════════════
     7. TOOLBAR
     ══════════════════════════════════════════════════════ */
  const IC = {
    mic: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    dots: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  const wrap = mk("div", "wrap");
  wrap.style.display = "none";

  const bar = mk("div", "bar idle");
  const items = mk("div", "items");

  const langEl = mk("span", "lang");
  langEl.textContent = state.language;

  const micBtn = mk("button", "btn mic");
  micBtn.innerHTML = IC.mic;

  const stopBtn = mk("button", "btn stop hide");
  stopBtn.innerHTML = IC.stop;

  // Waveform bars (during recording)
  const waveEl = mk("div", "wave hide");
  for (let i = 0; i < 5; i++) waveEl.appendChild(mk("span", "wave-bar"));

  // Transcribing indicator
  const spinEl = mk("div", "spin hide");
  spinEl.innerHTML = '<span class="spin-d">.</span><span class="spin-d">.</span><span class="spin-d">.</span>';

  const dotsBtn = mk("button", "btn");
  dotsBtn.innerHTML = IC.dots;

  const closeBtn = mk("button", "btn sm");
  closeBtn.innerHTML = IC.x;

  items.append(langEl, micBtn, stopBtn, waveEl, spinEl, dotsBtn, closeBtn);
  bar.appendChild(items);
  wrap.appendChild(bar);

  // Toast container
  const toastEl = mk("div", "toast-wrap");
  wrap.appendChild(toastEl);

  shadow.appendChild(wrap);

  /* ══════════════════════════════════════════════════════
     8. PREVENT FOCUS STEAL + DRAG
     ══════════════════════════════════════════════════════ */
  wrap.addEventListener(
    "mousedown",
    (e) => {
      saveCursor();
      e.preventDefault();
      e.stopPropagation();
      if (!e.target.closest("button") && !e.target.closest(".wave")) {
        state.dragging = true;
        state.dragMoved = false;
        state.dragOffset = {
          x: e.clientX - state.pos.x,
          y: e.clientY - state.pos.y,
        };
      }
    },
    true
  );

  document.addEventListener("mousemove", (e) => {
    if (!state.dragging) return;
    state.dragMoved = true;
    state.pos.x = Math.max(5, Math.min(e.clientX - state.dragOffset.x, innerWidth - 30));
    state.pos.y = Math.max(5, Math.min(e.clientY - state.dragOffset.y, innerHeight - 30));
    requestAnimationFrame(applyPos);
  });

  document.addEventListener("mouseup", () => {
    if (!state.dragging) return;
    state.dragging = false;
    if (state.dragMoved) save(SK.position, state.pos);
    setTimeout(() => (state.dragMoved = false), 20);
  });

  /* ══════════════════════════════════════════════════════
     9. POSITIONING + SHOW/HIDE
     ══════════════════════════════════════════════════════ */
  function applyPos() {
    wrap.style.left = "auto";
    wrap.style.right = (innerWidth - state.pos.x - 14) + "px";
    wrap.style.top = state.pos.y + "px";
  }

  function posNear(el) {
    const r = el.getBoundingClientRect();
    let x = r.left - 45;
    let y = r.top + Math.min(r.height, 80) / 2 - 7;
    if (x < 15) { x = r.left + 10; y = r.bottom + 8; }
    x = Math.max(8, Math.min(x, innerWidth - 50));
    y = Math.max(8, Math.min(y, innerHeight - 50));
    state.pos = { x, y };
    applyPos();
  }

  function show() {
    if (state.visible) return;
    state.visible = true;
    wrap.style.display = "";
    wrap.offsetHeight;
    wrap.classList.add("on");
    // Apply appearance mode
    if (state.appearance === "visible") setUI("expanded");
  }

  function hide() {
    if (!state.visible) return;
    if (state.recording || state.transcribing) return; // don't hide while active
    state.visible = false;
    wrap.classList.remove("on");
    setTimeout(() => {
      if (!state.visible) {
        wrap.style.display = "none";
        setUI("idle");
      }
    }, 300);
  }

  let hideTimer = null;
  document.addEventListener(
    "focusin",
    (e) => {
      clearTimeout(hideTimer);
      if (isInput(e.target)) {
        state.lastInput = e.target;
        saveCursor();
        if (state.appearance !== "minimal") {
          posNear(e.target);
          show();
        }
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const a = document.activeElement;
        if (!isInput(a) && !state.recording && !state.transcribing) hide();
      }, 400);
    },
    true
  );

  window.addEventListener("resize", () => {
    if (state.lastInput && state.visible) posNear(state.lastInput);
  });

  /* ══════════════════════════════════════════════════════
     10. UI STATE MACHINE
     ══════════════════════════════════════════════════════ */
  let leaveTimer = null;
  let recTimer = null; // max recording timer

  function setUI(s) {
    state.ui = s;
    bar.className = "bar " + s;

    micBtn.classList.toggle("hide", s === "recording" || s === "transcribing");
    stopBtn.classList.toggle("hide", s !== "recording");
    waveEl.classList.toggle("hide", s !== "recording");
    spinEl.classList.toggle("hide", s !== "transcribing");
    dotsBtn.classList.toggle("hide", s === "recording" || s === "transcribing");

    if (s !== "expanded" && s !== "recording" && s !== "transcribing") closeMenu();
  }

  bar.addEventListener("mouseenter", () => {
    clearTimeout(leaveTimer);
    if (state.ui === "idle" && state.appearance !== "minimal") setUI("expanded");
  });

  bar.addEventListener("mouseleave", () => {
    clearTimeout(leaveTimer);
    if (state.ui === "expanded" && !menuEl) {
      leaveTimer = setTimeout(() => {
        if (state.ui === "expanded" && !menuEl && state.appearance !== "visible") setUI("idle");
      }, 900);
    }
  });

  bar.addEventListener("click", (e) => {
    if (state.ui === "idle" && !state.dragMoved) {
      e.stopPropagation();
      setUI("expanded");
    }
  });

  /* ══════════════════════════════════════════════════════
     11. RECORDING
     ══════════════════════════════════════════════════════ */
  micBtn.addEventListener("click", (e) => { e.stopPropagation(); startRec(); });
  stopBtn.addEventListener("click", (e) => { e.stopPropagation(); stopRec(); });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.recording) stopRec();
    setUI("idle");
  });

  function startRec() {
    if (state.recording || state.transcribing) return;
    saveCursor();
    state.recStartTime = Date.now();
    chrome.runtime.sendMessage({
      action: "startRec",
      deviceId: state.micDevice,
    });

    // Max recording timer
    clearTimeout(recTimer);
    recTimer = setTimeout(() => {
      if (state.recording) {
        showToast("Max recording time reached", "warn");
        stopRec();
      }
    }, state.maxRecording * 1000);
  }

  function stopRec() {
    if (!state.recording) return;
    clearTimeout(recTimer);
    chrome.runtime.sendMessage({ action: "stopRec" });
    state.recording = false;
    state.transcribing = true;
    setUI("transcribing");
    playSound("stop");
  }

  function toggleRec() {
    if (state.recording) {
      stopRec();
    } else {
      if (!state.visible && state.lastInput) {
        posNear(state.lastInput);
        show();
      }
      if (state.appearance === "minimal" && state.lastInput) {
        // For minimal mode, show a tiny indicator
        wrap.style.display = "";
        wrap.classList.add("on");
      }
      if (state.ui === "idle") setUI("expanded");
      startRec();
    }
  }

  /* ══════════════════════════════════════════════════════
     12. TEXT INSERTION
     ══════════════════════════════════════════════════════ */
  function insertText(text) {
    const el = state.lastInput;
    if (!el) return;

    // Process voice commands if mode is "command"
    let finalText = text;
    if (state.mode === "command") {
      finalText = processVoiceCommands(finalText);
    }

    try {
      if (el.isContentEditable) {
        el.focus();
        if (state.savedRange) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(state.savedRange);
        }
        document.execCommand("insertText", false, finalText);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        el.focus();
        const s = state.savedCursor.s;
        const e = state.savedCursor.e;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        const before = el.value.substring(0, s);
        const after = el.value.substring(e);
        if (setter) setter.call(el, before + finalText + after);
        else el.value = before + finalText + after;
        el.selectionStart = el.selectionEnd = s + finalText.length;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (err) {
      console.warn("[Blabby] Insert failed:", err.message);
    }
  }

  /* ══════════════════════════════════════════════════════
     13. TOAST NOTIFICATIONS
     ══════════════════════════════════════════════════════ */
  function showToast(msg, type = "info") {
    const t = mk("div", "toast " + type);
    t.textContent = msg;
    toastEl.appendChild(t);
    t.offsetHeight; // reflow
    t.classList.add("show");
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  /* ══════════════════════════════════════════════════════
     14. MENU
     ══════════════════════════════════════════════════════ */
  let menuBg = null;
  let menuEl = null;

  dotsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuEl ? closeMenu() : openMenu();
  });

  function openMenu() {
    closeMenu();
    menuBg = mk("div", "menu-bg");
    menuBg.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); closeMenu(); });

    menuEl = mk("div", "menu");
    menuEl.addEventListener("mousedown", (ev) => ev.preventDefault());

    const above = state.pos.y > 300;
    menuEl.style.left = Math.max(10, Math.min(state.pos.x, innerWidth - 300)) + "px";
    if (above) menuEl.style.bottom = innerHeight - state.pos.y + 12 + "px";
    else menuEl.style.top = state.pos.y + 52 + "px";

    // Header
    const hdr = mk("div", "menu-hdr");
    const ico = document.createElement("img");
    ico.className = "menu-ico";
    ico.src = "https://www.google.com/s2/favicons?domain=" + location.hostname + "&sz=32";
    ico.onerror = () => (ico.style.display = "none");
    const name = mk("span", "menu-name");
    name.textContent = location.hostname.length > 18 ? location.hostname.slice(0, 16) + "…" : location.hostname;

    const pill = mk("div", "pill" + (state.siteAutoEnter ? " on" : ""));
    pill.innerHTML = '<span class="pill-x">×</span> auto-enter';
    pill.addEventListener("click", () => {
      state.siteAutoEnter = !state.siteAutoEnter;
      pill.className = "pill" + (state.siteAutoEnter ? " on" : "");
      chrome?.storage?.local?.get(SK.siteSettings, (d) => {
        const ss = d[SK.siteSettings] || {};
        ss[location.hostname] = state.siteAutoEnter;
        save(SK.siteSettings, ss);
      });
    });

    hdr.append(ico, name, pill);
    menuEl.append(hdr, mk("div", "sep"));

    // Mode selector in menu
    const mt = mk("div", "menu-title");
    mt.textContent = "Mode";
    menuEl.appendChild(mt);

    const modes = [
      ["none", "⊘", "No mode"],
      ["punctuation", "✦", "Punctuation"],
      ["command", "⌘", "Commands"],
    ];
    modes.forEach(([id, ico, label]) => {
      const item = mItem(ico, label, () => {
        state.mode = id;
        save(SK.mode, id);
        closeMenu();
        showToast("Mode: " + label);
      });
      if (state.mode === id) item.classList.add("active");
      menuEl.appendChild(item);
    });

    menuEl.appendChild(mk("div", "sep"));
    menuEl.appendChild(mItem("⚙", "Settings", () => { closeMenu(); openSettings(); }));

    shadow.append(menuBg, menuEl);
  }

  function closeMenu() {
    menuBg?.remove();
    menuEl?.remove();
    menuBg = null;
    menuEl = null;
  }

  function mItem(icon, text, fn) {
    const b = mk("button", "mi");
    const i = mk("span", "mi-ico");
    i.textContent = icon;
    const t = mk("span", "mi-txt");
    t.textContent = text;
    b.append(i, t);
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function mk(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* ══════════════════════════════════════════════════════
     15. SETTINGS
     ══════════════════════════════════════════════════════ */
  let settingsEl = null;

  function openSettings() {
    if (settingsEl) return;
    settingsEl = mk("div", "s-overlay");
    settingsEl.addEventListener("click", (e) => { if (e.target === settingsEl) closeSettings(); });
    settingsEl.addEventListener("mousedown", (e) => e.stopPropagation());

    const panel = mk("div", "s-panel");
    const sb = mk("div", "s-sb");
    const logo = mk("div", "s-logo");
    logo.innerHTML = "<span>🎙️</span> Blabby";
    sb.appendChild(logo);

    const nav = mk("div", "s-nav");
    const tabs = [
      ["general", "⚙", "General"],
      ["transcription", "🎤", "Transcription"],
      ["shortcut", "⌨️", "Shortcut"],
      ["languages", "🌐", "Languages"],
      ["modes", "✧", "Modes"],
      ["appearance", "🎨", "Appearance"],
      ["sound", "🔊", "Sound"],
    ];
    const content = mk("div", "s-content");

    tabs.forEach(([id, icon, label]) => {
      const b = mk("button", "s-tab" + (state.settingsTab === id ? " on" : ""));
      b.innerHTML = `<span class="s-tab-i">${icon}</span>${label}`;
      b.addEventListener("click", () => {
        state.settingsTab = id;
        nav.querySelectorAll(".s-tab").forEach((t) => t.classList.remove("on"));
        b.classList.add("on");
        renderTab(content);
      });
      nav.appendChild(b);
    });
    sb.appendChild(nav);

    const foot = mk("div", "s-foot");
    foot.appendChild(mk("div", "sep"));
    ["💡 Feature request", "🐛 Report a Bug", "🗺️ Roadmap"].forEach((t) => {
      const b = mk("button", "s-foot-btn");
      b.textContent = t;
      foot.appendChild(b);
    });
    sb.appendChild(foot);

    panel.append(sb, content);
    renderTab(content);
    settingsEl.appendChild(panel);
    shadow.appendChild(settingsEl);
  }

  function closeSettings() {
    settingsEl?.remove();
    settingsEl = null;
    state.shortcutListening = false;
  }

  function renderTab(c) {
    c.innerHTML = "";
    const cb = mk("button", "s-close");
    cb.textContent = "×";
    cb.addEventListener("click", closeSettings);
    c.appendChild(cb);
    const fn = {
      general: tabGeneral, transcription: tabTranscription, shortcut: tabShortcut,
      languages: tabLanguages, modes: tabModes, appearance: tabAppearance, sound: tabSound,
    };
    (fn[state.settingsTab] || tabGeneral)(c);
  }

  function shdr(c, title, sub) {
    const t = mk("h2", "s-title");
    t.textContent = title;
    const s = mk("p", "s-sub");
    s.textContent = sub;
    c.append(t, s);
  }

  /* ── GENERAL ── */
  function tabGeneral(c) {
    shdr(c, "General", "Configure general extension behavior.");
    c.appendChild(
      toggleRow("Auto-enter after transcription", "Press Enter automatically after inserting text. Uses smart mode on chat apps.", state.autoEnter, (v) => {
        state.autoEnter = v;
        save(SK.autoEnter, v);
      })
    );

    // Quality preset
    const qg = mk("div", "fg");
    qg.appendChild(lbl("Transcription Speed"));
    const qsel = mk("select", "sel");
    [
      ["fast", "Fast (beam=1) — quickest response"],
      ["balanced", "Balanced (beam=3) — recommended"],
      ["best", "Best (beam=5) — highest accuracy"],
    ].forEach(([v, t]) => {
      const o = mk("option");
      o.value = v;
      o.textContent = t;
      if (state.quality === v) o.selected = true;
      qsel.appendChild(o);
    });
    qsel.addEventListener("change", () => {
      state.quality = qsel.value;
      save(SK.quality, qsel.value);
      showToast("Quality: " + qsel.value);
    });
    qg.appendChild(qsel);
    c.appendChild(qg);

    // Server status
    const st = mk("div", "s-status");
    const dot = mk("span", "s-dot" + (state.serverOnline ? " on" : ""));
    const txt = mk("span");
    txt.textContent = ` Server: ${state.serverOnline ? "Online" : "Offline"} · Model: ${state.model} · ${state.serverOnline ? "GPU" : "—"}`;
    st.append(dot, txt);
    c.appendChild(st);
  }

  /* ── TRANSCRIPTION ── */
  function tabTranscription(c) {
    shdr(c, "Transcription", "Configure transcription settings and microphone device.");

    // Mic device
    const g1 = mk("div", "fg");
    g1.appendChild(lbl("Microphone Device"));
    const sel1 = mk("select", "sel");
    const def = mk("option");
    def.textContent = "Default";
    def.value = "default";
    if (state.micDevice === "default") def.selected = true;
    sel1.appendChild(def);

    navigator.mediaDevices?.enumerateDevices().then((devs) =>
      devs.filter((d) => d.kind === "audioinput").forEach((d) => {
        const o = mk("option");
        o.value = d.deviceId;
        o.textContent = d.label || "Mic (" + d.deviceId.slice(0, 6) + ")";
        if (state.micDevice === d.deviceId) o.selected = true;
        sel1.appendChild(o);
      })
    ).catch(() => {});

    sel1.addEventListener("change", () => {
      state.micDevice = sel1.value;
      save(SK.micDevice, sel1.value);
      showToast("Microphone changed");
    });
    g1.appendChild(sel1);
    c.appendChild(g1);

    // Model selection
    const g2 = mk("div", "fg");
    g2.appendChild(lbl("Transcription Model"));
    const sel2 = mk("select", "sel");

    // Indicate loading state
    if (state.modelLoading) {
      const lo = mk("option");
      lo.textContent = "Loading model…";
      lo.disabled = true;
      lo.selected = true;
      sel2.appendChild(lo);
      sel2.disabled = true;
    } else {
      [
        ["large-v3-turbo", "Whisper Large v3 Turbo (fastest, high accuracy)"],
        ["large-v3", "Whisper Large v3 (slowest, highest accuracy)"],
        ["medium", "Whisper Medium (balanced)"],
        ["small", "Whisper Small (fast)"],
        ["base", "Whisper Base (fastest, basic)"],
      ].forEach(([v, t]) => {
        const o = mk("option");
        o.value = v;
        o.textContent = t;
        if (state.model === v) o.selected = true;
        sel2.appendChild(o);
      });
    }

    sel2.addEventListener("change", () => {
      const newModel = sel2.value;
      if (newModel === state.model) return;
      state.modelLoading = true;
      showToast("Switching model to " + newModel + "…");
      renderTab(c); // refresh to show loading state

      chrome.runtime.sendMessage({ action: "changeModel", model: newModel }, (resp) => {
        state.modelLoading = false;
        if (resp?.error) {
          showToast("Model switch failed: " + resp.error, "error");
        } else {
          state.model = resp?.model || newModel;
          showToast("Model ready: " + state.model);
        }
        renderTab(c); // refresh
      });
    });

    const h = mk("p", "hint");
    h.textContent = "Switching models takes a few seconds. large-v3-turbo is recommended for the best speed/accuracy tradeoff.";
    g2.append(sel2, h);
    c.appendChild(g2);

    // Max recording time
    const g3 = mk("div", "fg");
    g3.appendChild(lbl("Max Recording Duration"));
    const sel3 = mk("select", "sel");
    [
      [60, "1 minute"], [120, "2 minutes"], [180, "3 minutes"],
      [300, "5 minutes (default)"], [600, "10 minutes"],
    ].forEach(([v, t]) => {
      const o = mk("option");
      o.value = v;
      o.textContent = t;
      if (state.maxRecording === v) o.selected = true;
      sel3.appendChild(o);
    });
    sel3.addEventListener("change", () => {
      state.maxRecording = parseInt(sel3.value);
      save(SK.maxRecording, state.maxRecording);
    });
    g3.appendChild(sel3);
    c.appendChild(g3);
  }

  /* ── SHORTCUT ── */
  function tabShortcut(c) {
    shdr(c, "Shortcut", "Set the keyboard shortcut to toggle recording.");
    const g = mk("div", "fg");
    g.appendChild(lbl("Toggle Recording"));

    const box = mk("div", "sc-box");
    box.tabIndex = 0;

    function showKeys() {
      box.innerHTML = "";
      const kd = mk("div", "sc-keys");
      state.shortcut.split("+").forEach((p) => {
        const k = mk("span", "sc-key");
        k.textContent = p.trim();
        kd.appendChild(k);
      });
      const h = mk("span", "sc-hint");
      h.textContent = state.shortcutListening ? "Press keys…" : "Click to change";
      box.append(kd, h);
      box.className = "sc-box" + (state.shortcutListening ? " on" : "");
    }
    showKeys();

    box.addEventListener("click", () => { state.shortcutListening = true; box.focus(); showKeys(); });
    box.addEventListener("blur", () => { state.shortcutListening = false; showKeys(); });
    box.addEventListener("keydown", (e) => {
      if (!state.shortcutListening) return;
      e.preventDefault();
      e.stopPropagation();
      const parts = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (e.metaKey) parts.push("Meta");
      if (!["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        state.shortcut = parts.join("+");
        save(SK.shortcut, state.shortcut);
        state.shortcutListening = false;
        showKeys();
        showToast("Shortcut: " + state.shortcut);
      }
    });

    const hint = mk("p", "hint");
    hint.textContent = "Chrome global shortcut (Ctrl+Space) is set in chrome://extensions/shortcuts. This shortcut works as an in-page toggle.";
    g.append(box, hint);
    c.appendChild(g);
  }

  /* ── LANGUAGES ── */
  function tabLanguages(c) {
    shdr(c, "Languages", "Manage languages and their custom spellings.");
    const LANG_MAP = {
      en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
      pt: "Portuguese", zh: "Chinese", ja: "Japanese", ko: "Korean", hi: "Hindi",
      ar: "Arabic", ru: "Russian", nl: "Dutch", sv: "Swedish", pl: "Polish",
      tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese", th: "Thai", auto: "Auto Detect",
    };

    const addBtn = mk("button", "btn-add");
    addBtn.textContent = "＋ Add language";
    addBtn.style.cssText = "position:absolute;top:28px;right:28px;";
    c.appendChild(addBtn);

    // Show all active languages
    state.languages.forEach((code) => {
      const card = mk("div", "lcard" + (code === state.language ? " active" : ""));
      const chdr = mk("div", "lcard-hdr");
      const nm = mk("span", "lcard-name");
      nm.textContent = LANG_MAP[code] || code;
      if (code === state.language) {
        const badge = mk("span", "lcard-badge");
        badge.textContent = "Active";
        nm.appendChild(badge);
      }
      const rm = mk("button", "lcard-rm");
      rm.textContent = "✕";
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.languages.length <= 1) return showToast("Need at least one language", "warn");
        state.languages = state.languages.filter((l) => l !== code);
        save(SK.languages, state.languages);
        if (state.language === code) {
          state.language = state.languages[0];
          langEl.textContent = state.language;
          save(SK.language, state.language);
        }
        renderTab(c);
      });
      chdr.append(nm, rm);
      card.appendChild(chdr);

      // Click to set as active language
      card.addEventListener("click", () => {
        state.language = code;
        langEl.textContent = state.language;
        save(SK.language, state.language);
        renderTab(c);
        showToast("Language: " + (LANG_MAP[code] || code));
      });
      c.appendChild(card);
    });

    addBtn.addEventListener("click", () => {
      if (c.querySelector(".lang-dd")) return;
      const sel = mk("select", "sel lang-dd");
      sel.style.marginTop = "12px";
      const ph = mk("option");
      ph.textContent = "— Select language —";
      ph.disabled = true;
      ph.selected = true;
      sel.appendChild(ph);
      Object.entries(LANG_MAP).forEach(([code, name]) => {
        if (state.languages.includes(code)) return;
        const o = mk("option");
        o.value = code;
        o.textContent = name;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        if (!state.languages.includes(sel.value)) {
          state.languages.push(sel.value);
          save(SK.languages, state.languages);
        }
        state.language = sel.value;
        langEl.textContent = state.language;
        save(SK.language, state.language);
        renderTab(c);
        showToast("Added: " + (LANG_MAP[sel.value] || sel.value));
      });
      c.appendChild(sel);
    });
  }

  /* ── MODES ── */
  function tabModes(c) {
    shdr(c, "Modes", "Choose a transcription mode.");
    [
      ["none", "No mode", "Default transcription without any special processing."],
      ["punctuation", "Punctuation", "Whisper auto-adds punctuation. Best for dictation."],
      ["command", "Command", "Voice commands: say \"new line\", \"period\", \"comma\", \"question mark\", \"delete\", etc."],
    ].forEach(([id, l, d]) => {
      const row = mk("div", "mode" + (state.mode === id ? " on" : ""));
      const radio = mk("div", "mode-r");
      const info = mk("div");
      const lb = mk("div", "mode-l");
      lb.textContent = l;
      const ds = mk("div", "mode-d");
      ds.textContent = d;
      info.append(lb, ds);
      row.append(radio, info);
      row.addEventListener("click", () => {
        state.mode = id;
        save(SK.mode, id);
        c.querySelectorAll(".mode").forEach((m) => m.classList.remove("on"));
        row.classList.add("on");
        showToast("Mode: " + l);
      });
      c.appendChild(row);
    });
  }

  /* ── APPEARANCE ── */
  function tabAppearance(c) {
    shdr(c, "Appearance", "Choose how the toolbar looks when idle.");
    const grid = mk("div", "a-grid");
    [
      { id: "dot", name: "Dot", desc: "Small dot that expands on hover\nMinimalistic and unobtrusive", tags: ["⊕ Movable", "↕ Expandable"], p: "dot" },
      { id: "visible", name: "Visible", desc: "Full toolbar when clicking text boxes\nQuick access to controls", tags: ["📌 Sticky", "⊕ Movable"], p: "vis" },
      { id: "hidden", name: "Hidden", desc: "Handle that expands on hover\nAuto-hides after recording", tags: ["📌 Sticky", "⊕ Movable", "↕ Expandable"], p: "hid" },
      { id: "minimal", name: "Minimal", desc: "Only visible while recording/transcribing\nFor keyboard shortcut users", tags: ["📌 Bottom", "✕ Non-Interactive"], p: "min" },
    ].forEach((a) => {
      const card = mk("div", "a-card" + (state.appearance === a.id ? " sel" : ""));
      const prev = mk("div", "a-prev");
      if (a.p === "dot") {
        prev.appendChild(mk("div", "p-dot"));
      } else if (a.p === "vis") {
        const tb = mk("div", "p-bar");
        tb.innerHTML = '<span style="color:#999;font-size:10px">en</span><span style="font-size:12px;color:#fbbf24">🎤</span><span style="font-size:11px">⋯</span>';
        prev.appendChild(tb);
      } else if (a.p === "hid") {
        prev.appendChild(mk("div", "p-handle"));
      } else {
        const m = mk("div", "p-min");
        m.innerHTML = '<span style="width:5px;height:5px;background:#fbbf24;border-radius:50%;display:inline-block"></span>';
        prev.appendChild(m);
      }

      const info = mk("div", "a-info");
      const nm = mk("div", "a-name");
      nm.textContent = a.name;
      const ds = mk("div", "a-desc");
      ds.textContent = a.desc;
      const tg = mk("div", "a-tags");
      a.tags.forEach((t) => {
        const s = mk("span", "a-tag"); s.textContent = t; tg.appendChild(s);
      });
      info.append(nm, ds, tg);
      card.append(prev, info);
      card.addEventListener("click", () => {
        grid.querySelectorAll(".a-card").forEach((c) => c.classList.remove("sel"));
        card.classList.add("sel");
        state.appearance = a.id;
        save(SK.appearance, a.id);
        showToast("Appearance: " + a.name);
        // Apply immediately
        if (a.id === "visible" && state.visible) setUI("expanded");
        if (a.id === "minimal") { hide(); }
      });
      grid.appendChild(card);
    });

    // Reset button
    const reset = mk("button", "s-reset");
    reset.textContent = "↻ Reset to Default Settings";
    reset.addEventListener("click", () => {
      state.appearance = "dot";
      save(SK.appearance, "dot");
      renderTab(c);
      showToast("Reset to defaults");
    });
    c.append(grid, reset);
  }

  /* ── SOUND ── */
  function tabSound(c) {
    shdr(c, "Sound", "Audio feedback for recording.");
    c.appendChild(
      toggleRow("Sound on start", "Tone when recording begins", state.sound.onStart, (v) => {
        state.sound.onStart = v;
        save(SK.sound, state.sound);
      })
    );
    c.appendChild(
      toggleRow("Sound on stop", "Tone when recording stops", state.sound.onStop, (v) => {
        state.sound.onStop = v;
        save(SK.sound, state.sound);
      })
    );
  }

  /* ── SETTINGS HELPERS ── */
  function lbl(t) {
    const l = mk("label", "fl");
    l.textContent = t;
    return l;
  }

  function toggleRow(label, hint, val, onChange) {
    const row = mk("div", "trow");
    const left = mk("div", "trow-left");
    const l = mk("div", "trow-l");
    l.textContent = label;
    left.appendChild(l);
    if (hint) {
      const h = mk("div", "trow-h");
      h.textContent = hint;
      left.appendChild(h);
    }
    const sw = mk("label", "sw");
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = val;
    const sl = mk("span", "slider");
    inp.addEventListener("change", () => onChange(inp.checked));
    sw.append(inp, sl);
    row.append(left, sw);
    return row;
  }

  /* ══════════════════════════════════════════════════════
     16. KEYBOARD SHORTCUT
     ══════════════════════════════════════════════════════ */
  document.addEventListener(
    "keydown",
    (e) => {
      if (state.shortcutListening) return;
      const parts = state.shortcut.split("+");
      const key = parts[parts.length - 1];
      const ctrl = parts.includes("Ctrl");
      const alt = parts.includes("Alt");
      const shift = parts.includes("Shift");
      const meta = parts.includes("Meta");
      if (!ctrl && !alt && !shift && !meta) return;
      const match = e.key.toUpperCase() === key.toUpperCase() || (key === "Space" && e.code === "Space");
      if (match && e.ctrlKey === ctrl && e.altKey === alt && e.shiftKey === shift && e.metaKey === meta) {
        e.preventDefault();
        e.stopPropagation();
        toggleRec();
      }
    },
    true
  );

  /* ══════════════════════════════════════════════════════
     17. MESSAGES FROM BACKGROUND
     ══════════════════════════════════════════════════════ */
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === "recStarted") {
        state.recording = true;
        setUI("recording");
        playSound("start");
      }
      if (msg.action === "recError") {
        console.warn("[Blabby] Recording error:", msg.error);
        state.recording = false;
        state.transcribing = false;
        setUI("expanded");
        showToast("Recording error: " + msg.error, "error");
      }
      if (msg.action === "audioLevel") {
        state.audioLevel = msg.level;
        updateWaveform(msg.level);
      }
      if (msg.action === "transcriptionResult") {
        state.transcribing = false;
        setUI("expanded");
        if (msg.text?.trim()) {
          restoreCursor();
          insertText(msg.text.trim());
          // Auto-enter
          if (msg.autoEnter) {
            setTimeout(() => doAutoEnter(), 50);
          }
        }
        // Auto-hide after transcription for hidden/minimal modes
        if (state.appearance === "hidden" || state.appearance === "minimal") {
          setTimeout(() => { if (!state.recording) setUI("idle"); }, 1500);
        }
      }
      if (msg.action === "transcriptionError") {
        state.transcribing = false;
        setUI("expanded");
        showToast("Transcription failed: " + (msg.error || "Unknown error"), "error");
      }
      if (msg.action === "toggle") toggleRec();
      if (msg.action === "openSettings") openSettings();
    });
  }

  /* ══════════════════════════════════════════════════════
     18. WAVEFORM UPDATE
     ══════════════════════════════════════════════════════ */
  function updateWaveform(level) {
    const bars = waveEl.querySelectorAll(".wave-bar");
    bars.forEach((b, i) => {
      // Create varied heights based on level + pseudo-random offset
      const offset = Math.sin(Date.now() / 150 + i * 1.7) * 0.3 + 0.7;
      const h = Math.max(4, level * offset * 24);
      b.style.height = h + "px";
    });
  }

  /* ══════════════════════════════════════════════════════
     19. HEALTH CHECK
     ══════════════════════════════════════════════════════ */
  async function checkHealth() {
    try {
      const r = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "healthCheck" }, resolve);
      });
      state.serverOnline = r?.online ?? false;
      if (r?.model) state.model = r.model;
    } catch {
      state.serverOnline = false;
    }
  }

  /* ══════════════════════════════════════════════════════
     20. INIT
     ══════════════════════════════════════════════════════ */
  (async () => {
    await loadSettings();
    langEl.textContent = state.language;
    applyPos();
    setUI("idle");
    checkHealth();
    setInterval(checkHealth, 30000);
  })();

  /* ══════════════════════════════════════════════════════
     CSS — PURE BLACK THEME + PRODUCTION ANIMATIONS
     ══════════════════════════════════════════════════════ */
  function getCSS() {
    return `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:host{all:initial}

/* ── Wrapper ── */
.wrap{
  position:fixed;pointer-events:auto;user-select:none;-webkit-user-select:none;
  will-change:transform;z-index:1;
  filter:drop-shadow(0 2px 12px rgba(0,0,0,0.6));
  opacity:0;transition:opacity .3s ease;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:13px;color:#ddd;line-height:1.4;
  display:flex;flex-direction:column;align-items:flex-end;
}
.wrap.on{opacity:1}

/* ── Bar ── */
.bar{
  display:flex;align-items:center;gap:0;
  background:#000;border-radius:50px;padding:0;
  cursor:grab;overflow:hidden;
  transition:all .35s cubic-bezier(.4,0,.2,1);
  height:40px;width:40px;justify-content:center;
}
.bar:active{cursor:grabbing}

.bar.idle{
  width:14px;height:14px;background:transparent;
  border:2px solid rgba(255,255,255,0.25);
  border-radius:50%;opacity:0.6;
}
.bar.idle:hover{opacity:1;border-color:rgba(255,255,255,0.5);transform:scale(1.3)}

.bar.expanded{
  width:auto;min-width:190px;height:44px;padding:4px 6px;gap:2px;
  background:#000;border:1px solid rgba(255,255,255,0.12);opacity:1;
}

.bar.recording{
  width:auto;min-width:180px;height:44px;padding:4px 6px;gap:2px;
  background:#000;border:2px solid #ef4444;opacity:1;
  animation:pulse 1.8s ease-in-out infinite;
}

.bar.transcribing{
  width:auto;min-width:140px;height:44px;padding:4px 6px;gap:2px;
  background:#000;border:2px solid #3b82f6;opacity:1;
  animation:tpulse 1.5s ease-in-out infinite;
}

@keyframes pulse{
  0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5),0 0 16px rgba(239,68,68,.15)}
  50%{box-shadow:0 0 0 6px rgba(239,68,68,0),0 0 30px rgba(239,68,68,.35)}
}
@keyframes tpulse{
  0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,.4)}
  50%{box-shadow:0 0 0 5px rgba(59,130,246,0),0 0 20px rgba(59,130,246,.2)}
}

/* ── Items ── */
.items{
  display:flex;align-items:center;gap:2px;
  opacity:0;max-width:0;overflow:hidden;
  transition:all .35s cubic-bezier(.4,0,.2,1);white-space:nowrap;
}
.bar.expanded .items,.bar.recording .items,.bar.transcribing .items{opacity:1;max-width:300px}
.bar.idle .items{opacity:0;max-width:0}

/* ── Buttons ── */
.btn{
  display:flex;align-items:center;justify-content:center;
  width:34px;height:34px;border-radius:50%;border:none;
  background:transparent;color:#bbb;cursor:pointer;
  transition:all .15s;flex-shrink:0;outline:none;
  font-family:inherit;-webkit-appearance:none;
}
.btn:hover{background:rgba(255,255,255,.1);color:#fff}
.btn:active{transform:scale(.9)}
.btn.mic{color:#fbbf24}
.btn.mic:hover{background:rgba(251,191,36,.12);color:#fcd34d}
.btn.stop{color:#ef4444}
.btn.stop:hover{background:rgba(239,68,68,.12);color:#f87171}
.btn.sm{width:26px;height:26px}
.hide{display:none!important}

.lang{
  font-size:12px;font-weight:600;color:#888;padding:0 8px;
  letter-spacing:.5px;text-transform:lowercase;flex-shrink:0;
}
.bar.recording .lang{color:#fca5a5}
.bar.transcribing .lang{color:#93c5fd}

/* ── Waveform ── */
.wave{
  display:flex;align-items:center;gap:2px;padding:0 4px;height:24px;
}
.wave-bar{
  width:3px;min-height:4px;background:#ef4444;border-radius:2px;
  transition:height .08s ease;
}

/* ── Transcribing Spinner ── */
.spin{display:flex;align-items:center;gap:1px;padding:0 6px;color:#60a5fa}
.spin-d{
  font-size:18px;font-weight:700;
  animation:bounce .8s ease-in-out infinite;
}
.spin-d:nth-child(2){animation-delay:.15s}
.spin-d:nth-child(3){animation-delay:.3s}
@keyframes bounce{
  0%,80%,100%{opacity:.3;transform:translateY(0)}
  40%{opacity:1;transform:translateY(-4px)}
}

/* ── Toast ── */
.toast-wrap{
  position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
  display:flex;flex-direction:column;gap:8px;align-items:center;
  pointer-events:none;z-index:50;
}
.toast{
  background:#1a1a1a;border:1px solid rgba(255,255,255,.08);
  border-radius:10px;padding:8px 16px;font-size:12px;color:#ccc;
  opacity:0;transform:translateY(10px);transition:all .3s ease;
  pointer-events:auto;white-space:nowrap;
  box-shadow:0 4px 16px rgba(0,0,0,.5);
}
.toast.show{opacity:1;transform:translateY(0)}
.toast.warn{border-color:rgba(251,191,36,.3);color:#fbbf24}
.toast.error{border-color:rgba(239,68,68,.3);color:#f87171}

/* ── Menu ── */
.menu-bg{position:fixed;inset:0;pointer-events:auto;z-index:10}
.menu{
  position:fixed;pointer-events:auto;background:#0a0a0a;
  border:1px solid rgba(255,255,255,.1);border-radius:14px;
  padding:10px 0;min-width:270px;z-index:11;
  box-shadow:0 12px 48px rgba(0,0,0,.7);
  animation:menuIn .2s cubic-bezier(.4,0,.2,1);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:13px;color:#ccc;
}
@keyframes menuIn{from{opacity:0;transform:translateY(6px) scale(.96)}to{opacity:1;transform:none}}

.menu-hdr{display:flex;align-items:center;gap:8px;padding:8px 14px 10px}
.menu-ico{width:18px;height:18px;border-radius:3px}
.menu-name{font-size:12px;font-weight:600;color:#ccc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{
  display:flex;align-items:center;gap:5px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
  border-radius:20px;padding:3px 9px;cursor:pointer;font-size:11px;color:#666;
  transition:all .2s;flex-shrink:0;
}
.pill:hover{background:rgba(255,255,255,.08);color:#999}
.pill.on{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.25);color:#60a5fa}
.pill-x{font-size:10px;opacity:.5}
.sep{height:1px;background:rgba(255,255,255,.06);margin:6px 0}
.menu-title{padding:6px 14px 3px;font-size:12px;font-weight:600;color:#555}
.mi{
  display:flex;align-items:center;gap:10px;padding:9px 14px;
  cursor:pointer;transition:background .12s;color:#bbb;font-size:13px;
  border:none;background:none;width:100%;text-align:left;font-family:inherit;outline:none;
}
.mi:hover{background:rgba(255,255,255,.05)}
.mi.active{background:rgba(59,130,246,.08);color:#60a5fa}
.mi-ico{width:20px;text-align:center;color:#777;font-size:15px;flex-shrink:0}
.mi-txt{flex:1;font-weight:500}

/* ══ Settings ══ */
.s-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.7);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  display:flex;align-items:center;justify-content:center;
  z-index:100;pointer-events:auto;animation:fadeIn .2s;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  font-size:13px;color:#ccc;line-height:1.45;
}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}

.s-panel{
  width:800px;max-width:92vw;height:580px;max-height:85vh;
  background:#0a0a0a;border:1px solid rgba(255,255,255,.07);
  border-radius:18px;display:flex;overflow:hidden;
  box-shadow:0 24px 72px rgba(0,0,0,.7);
  animation:panelIn .25s cubic-bezier(.4,0,.2,1);
}
@keyframes panelIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}

/* sidebar */
.s-sb{
  width:210px;min-width:210px;background:#050505;
  border-right:1px solid rgba(255,255,255,.05);
  display:flex;flex-direction:column;padding:18px 0;overflow-y:auto;
}
.s-sb::-webkit-scrollbar{width:3px}
.s-sb::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:2px}

.s-logo{
  display:flex;align-items:center;gap:8px;padding:0 18px 18px;
  font-size:18px;font-weight:700;color:#fff;
}
.s-nav{flex:1;display:flex;flex-direction:column;gap:1px;padding:0 7px}
.s-tab{
  display:flex;align-items:center;gap:9px;padding:9px 11px;
  border-radius:9px;cursor:pointer;color:#777;font-size:13px;font-weight:500;
  transition:all .12s;border:none;background:none;width:100%;text-align:left;
  font-family:inherit;outline:none;
}
.s-tab:hover{background:rgba(255,255,255,.04);color:#aaa}
.s-tab.on{background:rgba(70,130,220,.12);color:#60a5fa}
.s-tab-i{width:18px;text-align:center;font-size:14px;flex-shrink:0}
.s-foot{padding:10px 7px 0;display:flex;flex-direction:column;gap:1px}
.s-foot-btn{
  display:flex;align-items:center;gap:8px;padding:7px 11px;
  border-radius:9px;cursor:pointer;color:#555;font-size:12px;font-weight:500;
  transition:all .12s;border:none;background:none;width:100%;text-align:left;
  font-family:inherit;outline:none;
}
.s-foot-btn:hover{background:rgba(255,255,255,.03);color:#888}

/* content area */
.s-content{
  flex:1;padding:26px 32px;overflow-y:auto;position:relative;
}
.s-content::-webkit-scrollbar{width:5px}
.s-content::-webkit-scrollbar-track{background:transparent}
.s-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:3px}

.s-close{
  position:absolute;top:22px;right:22px;width:32px;height:32px;
  border-radius:9px;border:none;background:transparent;color:#666;
  cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center;
  transition:all .15s;font-family:inherit;outline:none;z-index:1;
}
.s-close:hover{background:rgba(255,255,255,.06);color:#bbb}

.s-title{font-size:22px;font-weight:700;color:#f0f0f0;margin:0 0 8px 0;line-height:1.2}
.s-sub{font-size:13px;color:#555;margin:0 0 26px 0;line-height:1.4}

/* form elements */
.fg{margin-bottom:22px}
.fl{display:block;font-size:13px;font-weight:600;color:#ccc;margin-bottom:8px}
.hint{font-size:12px;color:#555;margin-top:8px;line-height:1.5}
.sel{
  width:100%;max-width:440px;padding:10px 14px;
  background:#111;border:1px solid rgba(255,255,255,.08);
  border-radius:9px;color:#ccc;font-size:13px;font-family:inherit;
  cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 12px center;
  transition:border-color .15s;
}
.sel:hover,.sel:focus{border-color:rgba(255,255,255,.15)}
.sel:disabled{opacity:.5;cursor:wait}
.sel option{background:#111;color:#ccc}

/* toggle row */
.trow{
  display:flex;align-items:center;justify-content:space-between;
  gap:20px;padding:14px 0;max-width:440px;
  border-bottom:1px solid rgba(255,255,255,.04);
}
.trow-left{flex:1;min-width:0}
.trow-l{font-size:14px;color:#ccc;font-weight:500;line-height:1.35;margin-bottom:3px}
.trow-h{font-size:12px;color:#555;line-height:1.35}
.sw{position:relative;width:42px;height:22px;flex-shrink:0;cursor:pointer;display:block}
.sw input{opacity:0;width:0;height:0;position:absolute}
.slider{position:absolute;inset:0;background:#2a2a2a;border-radius:11px;transition:.25s}
.slider::before{
  content:'';position:absolute;height:16px;width:16px;left:3px;bottom:3px;
  background:#fff;border-radius:50%;transition:.25s;
}
.sw input:checked+.slider{background:#3b82f6}
.sw input:checked+.slider::before{transform:translateX(20px)}

/* shortcut */
.sc-box{
  display:flex;align-items:center;gap:8px;padding:11px 14px;
  background:#111;border:2px solid rgba(255,255,255,.06);
  border-radius:9px;max-width:440px;cursor:pointer;transition:all .15s;outline:none;
}
.sc-box:hover{border-color:rgba(255,255,255,.12)}
.sc-box.on{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
.sc-keys{display:flex;gap:6px;flex:1}
.sc-key{
  background:#1a1a1a;color:#ccc;padding:4px 10px;border-radius:5px;
  font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,.08);
}
.sc-hint{font-size:12px;color:#555;white-space:nowrap}

/* languages */
.lcard{
  background:#111;border:1px solid rgba(255,255,255,.06);
  border-radius:11px;padding:14px;margin-bottom:10px;max-width:440px;
  cursor:pointer;transition:all .15s;
}
.lcard:hover{border-color:rgba(255,255,255,.12)}
.lcard.active{border-color:rgba(59,130,246,.3);background:rgba(59,130,246,.04)}
.lcard-hdr{display:flex;align-items:center;justify-content:space-between}
.lcard-name{font-size:14px;font-weight:600;color:#ccc;display:flex;align-items:center;gap:8px}
.lcard-badge{
  font-size:10px;background:rgba(59,130,246,.15);color:#60a5fa;
  padding:2px 8px;border-radius:4px;font-weight:600;
}
.lcard-rm{
  width:26px;height:26px;border-radius:7px;border:none;background:transparent;
  color:#ef4444;cursor:pointer;font-size:14px;display:flex;align-items:center;
  justify-content:center;transition:background .15s;outline:none;font-family:inherit;
}
.lcard-rm:hover{background:rgba(239,68,68,.08)}
.btn-add{
  display:inline-flex;align-items:center;gap:5px;padding:7px 14px;
  background:#3b82f6;color:#fff;border:none;border-radius:9px;
  font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;
}
.btn-add:hover{background:#2563eb}

/* modes */
.mode{
  display:flex;align-items:center;gap:12px;padding:12px 0;
  cursor:pointer;max-width:440px;border-bottom:1px solid rgba(255,255,255,.03);
}
.mode-r{
  width:16px;height:16px;border:2px solid #3a3a3a;border-radius:50%;
  flex-shrink:0;position:relative;transition:all .15s;
}
.mode.on .mode-r{border-color:#3b82f6}
.mode.on .mode-r::after{
  content:'';position:absolute;top:3px;left:3px;width:6px;height:6px;
  background:#3b82f6;border-radius:50%;
}
.mode-l{font-size:13px;color:#ccc;font-weight:500}
.mode-d{font-size:12px;color:#555;margin-top:2px;line-height:1.45}

/* appearance */
.a-grid{display:flex;flex-direction:column;gap:12px;max-width:500px}
.a-card{
  display:flex;background:#0e0e0e;border:2px solid transparent;
  border-radius:12px;overflow:hidden;cursor:pointer;transition:all .15s;
}
.a-card:hover{border-color:rgba(255,255,255,.08)}
.a-card.sel{border-color:#4ade80}
.a-prev{
  width:150px;min-height:75px;background:#080808;
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.a-info{padding:12px 16px;flex:1}
.a-name{font-size:14px;font-weight:700;color:#eee;margin-bottom:3px}
.a-desc{font-size:11px;color:#555;line-height:1.45;margin-bottom:6px;white-space:pre-line}
.a-tags{display:flex;gap:8px;flex-wrap:wrap}
.a-tag{font-size:10px;color:#666}
.p-dot{width:8px;height:8px;border-radius:50%;border:1.5px solid rgba(255,255,255,.2)}
.p-bar{
  display:flex;align-items:center;gap:4px;background:#000;
  border-radius:16px;padding:5px 8px;border:1px solid rgba(255,255,255,.06);
}
.p-handle{width:50px;height:3px;background:#333;border-radius:2px}
.p-min{display:flex;align-items:center;gap:4px}

/* reset button */
.s-reset{
  display:flex;align-items:center;gap:6px;
  margin-top:24px;padding:10px 16px;
  background:transparent;border:1px solid rgba(255,255,255,.06);
  border-radius:9px;color:#666;font-size:12px;cursor:pointer;
  font-family:inherit;transition:all .15s;
}
.s-reset:hover{border-color:rgba(255,255,255,.12);color:#999}

/* server status */
.s-status{
  display:flex;align-items:center;gap:8px;font-size:12px;color:#555;
  margin-top:18px;padding:10px 14px;background:#0e0e0e;
  border-radius:9px;max-width:440px;border:1px solid rgba(255,255,255,.04);
}
.s-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0}
.s-dot.on{background:#22c55e;box-shadow:0 0 5px rgba(34,197,94,.3)}
`;
  }
})();