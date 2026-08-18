(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
    BACK: "Escape",
  };

  var STORAGE_BEST = "trace_v1_best";
  var COVER_DIST = 26;
  var TICK_GAP = 16;
  var HUD_TOP = 56;
  var PASS_PCT = 90;

  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var bestEl = document.getElementById("best-readout");
  var pauseOverlay = document.getElementById("pause-overlay");
  var scoreOverlay = document.getElementById("score-overlay");
  var scoreTitle = document.getElementById("score-title");
  var scoreReadout = document.getElementById("score-readout");
  var scoreDetail = document.getElementById("score-detail");
  var nextBtn = document.getElementById("next-btn");

  var TAP_PX = 28;
  var ACTION_MS = 400;
  var lastFocusable = null;
  var lastActionAt = 0;
  var lastActionName = "";
  var suppressSelectUntil = 0;
  var tap = {
    active: false,
    drawing: false,
    x: 0,
    y: 0,
    moved: false,
  };
  var lastRelease = { x: -9999, y: -9999 };
  var audioCtx = null;
  var traceOnOsc = null;
  var traceOffOsc = null;
  var traceOnGain = null;
  var traceOffGain = null;
  var traceOnPath = null;

  var screens = {};
  var currentScreen = "home";
  var rafId = 0;
  var figures = buildFigures();

  var state = {
    figure: 0,
    drawing: false,
    stroke: [],
    pencil: { x: 300, y: 300 },
    lastPtr: null,
    overlay: "",
    best: loadBest(),
    claimed: [],
    claimedCount: 0,
    lastPct: 0,
  };

  function loadBest() {
    try {
      var raw = localStorage.getItem(STORAGE_BEST);
      if (raw == null || raw === "") return -1;
      var n = Number(raw);
      return n >= 0 && n <= 100 ? n : -1;
    } catch (err) {
      return -1;
    }
  }

  function saveBest(score) {
    if (score > state.best) {
      state.best = score;
      try {
        localStorage.setItem(STORAGE_BEST, String(score));
      } catch (err) {
        /* quota */
      }
    }
    renderBest();
  }

  function renderBest() {
    bestEl.textContent =
      state.best < 0 ? "BEST --" : "BEST " + state.best + "%";
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function isFocusable(el) {
    return !!(
      el &&
      el.classList &&
      el.classList.contains("focusable") &&
      !el.disabled &&
      !el.classList.contains("hidden") &&
      el.offsetParent !== null
    );
  }

  function focusedControl() {
    if (isFocusable(document.activeElement)) return document.activeElement;
    if (isFocusable(lastFocusable)) return lastFocusable;
    if (state.overlay === "score") {
      return scoreOverlay.querySelector(".focusable:not([disabled]):not(.hidden)");
    }
    if (state.overlay === "pause") {
      return pauseOverlay.querySelector(".focusable:not([disabled]):not(.hidden)");
    }
    var container = screens[currentScreen];
    return container
      ? container.querySelector(".focusable:not([disabled]):not(.hidden)")
      : null;
  }

  function activateControl(el) {
    if (!isFocusable(el)) return false;
    var action = el.getAttribute("data-action");
    if (!action) return false;
    el.focus();
    handleAction(action);
    return true;
  }

  function collectScreens() {
    document.querySelectorAll(".screen").forEach(function (screen) {
      if (screen.id) screens[screen.id] = screen;
    });
  }

  function focusFirst(container) {
    var el = container.querySelector(".focusable:not([disabled]):not(.hidden)");
    if (el) el.focus();
  }

  function navigateTo(screenId) {
    Object.keys(screens).forEach(function (id) {
      screens[id].classList.add("hidden");
    });
    if (!screens[screenId]) return;
    screens[screenId].classList.remove("hidden");
    currentScreen = screenId;
    if (screenId === "play") {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      startLoop();
    } else {
      stopLoop();
      focusFirst(screens[screenId]);
    }
  }

  function moveFocus(direction) {
    var container = screens[currentScreen];
    if (!container) return;
    var focusables = Array.from(
      container.querySelectorAll(".focusable:not([disabled]):not(.hidden)")
    ).filter(function (el) {
      return el.offsetParent !== null;
    });
    if (!focusables.length) return;
    var idx = focusables.indexOf(document.activeElement);
    if (idx === -1) {
      focusables[0].focus();
      return;
    }
    var next =
      direction === "up" || direction === "left"
        ? idx > 0
          ? idx - 1
          : focusables.length - 1
        : idx < focusables.length - 1
          ? idx + 1
          : 0;
    focusables[next].focus();
  }

  function densify(pts, closed, spacing) {
    var out = [];
    var n = pts.length;
    if (!n) return out;
    var segs = closed ? n : n - 1;
    var i;
    for (i = 0; i < segs; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % n];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var steps = Math.max(1, Math.round(len / spacing));
      var s;
      for (s = 0; s < steps; s++) {
        var t = s / steps;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    if (!closed) out.push(pts[n - 1]);
    return out;
  }

  function ticksFrom(pts, closed) {
    return densify(pts, closed, TICK_GAP);
  }

  function makeFigure(name, pts, closed) {
    var path = densify(pts, closed, 4);
    return {
      name: name,
      closed: closed,
      path: path,
      ticks: ticksFrom(path, closed),
      start: path[0],
    };
  }

  function poly(n, cx, cy, r, rot) {
    var pts = [];
    var i;
    for (i = 0; i < n; i++) {
      var a = rot + (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function ellipse(cx, cy, rx, ry, n) {
    var pts = [];
    var i;
    for (i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
    }
    return pts;
  }

  function heart(cx, cy, s) {
    var pts = [];
    var n = 72;
    var i;
    for (i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2;
      var x = 16 * Math.pow(Math.sin(t), 3);
      var y = -(
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)
      );
      pts.push({ x: cx + x * s, y: cy + y * s });
    }
    return pts;
  }

  function house(cx, cy, w, h) {
    var left = cx - w / 2;
    var right = cx + w / 2;
    var eaves = cy - h * 0.12;
    var floor = cy + h / 2;
    var peak = cy - h / 2;
    return [
      { x: left, y: floor },
      { x: left, y: eaves },
      { x: cx, y: peak },
      { x: right, y: eaves },
      { x: right, y: floor },
    ];
  }

  function star(cx, cy, outer, inner, spikes) {
    var pts = [];
    var n = spikes * 2;
    var i;
    for (i = 0; i < n; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function arch(cx, cy, r) {
    var pts = [];
    var i;
    for (i = 0; i <= 32; i++) {
      var t = Math.PI + (i / 32) * Math.PI;
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
    return pts;
  }

  function ess(cx, cy, w, h) {
    var pts = [];
    var i;
    for (i = 0; i <= 48; i++) {
      var t = i / 48;
      pts.push({
        x: cx - (w / 2) * Math.sin(t * Math.PI * 2),
        y: cy - h / 2 + t * h,
      });
    }
    return pts;
  }

  function moon(cx, cy, r) {
    var pts = [];
    var i;
    var span = 1.35 * Math.PI;
    var start = -span / 2;
    for (i = 0; i <= 24; i++) {
      var t = start + (i / 24) * span;
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
    for (i = 24; i >= 0; i--) {
      var u = start + (i / 24) * span;
      pts.push({
        x: cx + 36 + r * 0.62 * Math.cos(u),
        y: cy + r * 0.62 * Math.sin(u),
      });
    }
    return pts;
  }

  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, dur, type, vol, delay, slideTo) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(Math.max(40, freq), t);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(40, slideTo),
        t + dur
      );
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function sfxRelease() {
    beep(680, 0.05, "triangle", 0.045);
  }

  function sfxPass() {
    beep(523, 0.09, "sine", 0.07, 0.04);
    beep(784, 0.16, "sine", 0.08, 0.13);
  }

  function sfxFail() {
    beep(196, 0.1, "square", 0.04, 0.04, 150);
    beep(130, 0.16, "triangle", 0.045, 0.13);
  }

  function onOutline(pt, fig) {
    var ticks = fig.ticks;
    var i;
    for (i = 0; i < ticks.length; i++) {
      if (Math.hypot(pt.x - ticks[i].x, pt.y - ticks[i].y) <= COVER_DIST) {
        return true;
      }
    }
    return false;
  }

  function startVoice(ctx, freq, type) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    return { osc: osc, gain: gain };
  }

  function fadeGain(gain, vol, dur) {
    if (!gain || !audioCtx) return;
    var t = audioCtx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t + dur);
  }

  function startTraceTone() {
    var ctx = ensureAudio();
    if (!ctx) return;
    stopTraceTone();
    var on = startVoice(ctx, 523, "sine");
    var off = startVoice(ctx, 280, "triangle");
    traceOnOsc = on.osc;
    traceOnGain = on.gain;
    traceOffOsc = off.osc;
    traceOffGain = off.gain;
    fadeGain(traceOnGain, 0.018, 0.05);
    traceOnPath = true;
  }

  function setTraceTone(onPath) {
    if (!traceOnGain || !traceOffGain) return;
    if (traceOnPath === onPath) return;
    traceOnPath = onPath;
    fadeGain(traceOnGain, onPath ? 0.018 : 0.0001, 0.07);
    fadeGain(traceOffGain, onPath ? 0.0001 : 0.014, 0.07);
  }

  function stopTraceTone() {
    if (!traceOnOsc && !traceOffOsc) {
      traceOnPath = null;
      return;
    }
    fadeGain(traceOnGain, 0.0001, 0.03);
    fadeGain(traceOffGain, 0.0001, 0.03);
    if (audioCtx) {
      var t = audioCtx.currentTime + 0.05;
      try {
        if (traceOnOsc) traceOnOsc.stop(t);
      } catch (err) {
        /* ignore */
      }
      try {
        if (traceOffOsc) traceOffOsc.stop(t);
      } catch (err) {
        /* ignore */
      }
    }
    traceOnOsc = null;
    traceOffOsc = null;
    traceOnGain = null;
    traceOffGain = null;
    traceOnPath = null;
  }

  function tree() {
    return [
      { x: 300, y: 86 },
      { x: 244, y: 164 },
      { x: 270, y: 164 },
      { x: 202, y: 248 },
      { x: 234, y: 248 },
      { x: 160, y: 340 },
      { x: 200, y: 340 },
      { x: 118, y: 444 },
      { x: 248, y: 444 },
      { x: 248, y: 516 },
      { x: 352, y: 516 },
      { x: 352, y: 444 },
      { x: 482, y: 444 },
      { x: 400, y: 340 },
      { x: 440, y: 340 },
      { x: 366, y: 248 },
      { x: 398, y: 248 },
      { x: 330, y: 164 },
      { x: 356, y: 164 },
    ];
  }

  function arrow() {
    return [
      { x: 90, y: 260 },
      { x: 330, y: 260 },
      { x: 330, y: 180 },
      { x: 510, y: 318 },
      { x: 330, y: 456 },
      { x: 330, y: 376 },
      { x: 90, y: 376 },
    ];
  }

  function spiral(cx, cy, r0, r1, turns) {
    var pts = [];
    var n = 72;
    var i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var a = t * turns * Math.PI * 2 - Math.PI / 2;
      var r = r0 + (r1 - r0) * t;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function metaMark(cx, cy, a) {
    var pts = [];
    var n = 96;
    var i;
    var s = a * Math.sqrt(2);
    for (i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2;
      var d = 1 + Math.sin(t) * Math.sin(t);
      pts.push({
        x: cx + (s * Math.cos(t)) / d,
        y: cy + (s * Math.cos(t) * Math.sin(t)) / d,
      });
    }
    return pts;
  }

  function buildFigures() {
    var cx = 300;
    var cy = 318;
    return [
      makeFigure("LINE", [{ x: 90, y: 320 }, { x: 510, y: 320 }], false),
      makeFigure("SLASH", [{ x: 120, y: 460 }, { x: 480, y: 180 }], false),
      makeFigure(
        "L",
        [
          { x: 150, y: 150 },
          { x: 150, y: 470 },
          { x: 470, y: 470 },
        ],
        false
      ),
      makeFigure(
        "Z",
        [
          { x: 140, y: 170 },
          { x: 460, y: 170 },
          { x: 140, y: 470 },
          { x: 460, y: 470 },
        ],
        false
      ),
      makeFigure("TRIANGLE", poly(3, cx, cy + 18, 186, -Math.PI / 2), true),
      makeFigure("SQUARE", poly(4, cx, cy, 168, Math.PI / 4), true),
      makeFigure("DIAMOND", poly(4, cx, cy, 176, 0), true),
      makeFigure("PENTAGON", poly(5, cx, cy, 176, -Math.PI / 2), true),
      makeFigure("HOUSE", house(cx, cy + 8, 280, 260), true),
      makeFigure("ARROW", arrow(), true),
      makeFigure("CIRCLE", ellipse(cx, cy, 168, 168, 48), true),
      makeFigure("ARCH", arch(cx, cy + 40, 180), false),
      makeFigure("OVAL", ellipse(cx, cy, 210, 120, 48), true),
      makeFigure("S", ess(cx, cy, 200, 280), false),
      makeFigure("HEART", heart(cx, cy + 8, 11.2), true),
      makeFigure("MOON", moon(cx - 10, cy, 170), true),
      makeFigure("STAR", star(cx, cy, 176, 78, 5), true),
      makeFigure("SPIRAL", spiral(cx, cy, 22, 168, 2.2), false),
      makeFigure("TREE", tree(), true),
      makeFigure("META", metaMark(cx, cy, 148), true),
    ];
  }

  function currentFigure() {
    return figures[state.figure % figures.length];
  }

  function tracedPct() {
    var ticks = currentFigure().ticks;
    if (!ticks.length) return 0;
    return Math.round((100 * state.claimedCount) / ticks.length);
  }

  function claimTicks(pt, fig) {
    var ticks = fig.ticks;
    var i;
    for (i = 0; i < ticks.length; i++) {
      if (state.claimed[i]) continue;
      if (Math.hypot(pt.x - ticks[i].x, pt.y - ticks[i].y) <= COVER_DIST) {
        state.claimed[i] = 1;
        state.claimedCount += 1;
      }
    }
  }

  function addStrokePoint(pt) {
    state.stroke.push(pt);
    claimTicks(pt, currentFigure());
  }

  function resetStroke() {
    var fig = currentFigure();
    stopTraceTone();
    state.drawing = false;
    state.stroke = [];
    state.claimed = [];
    state.claimedCount = 0;
    state.pencil = { x: fig.start.x, y: fig.start.y };
    state.lastPtr = null;
  }

  function startRound() {
    hideOverlay();
    resetStroke();
    navigateTo("play");
  }

  function hideOverlay() {
    state.overlay = "";
    pauseOverlay.classList.add("hidden");
    scoreOverlay.classList.add("hidden");
  }

  function showPause() {
    if (currentScreen !== "play" || state.overlay === "score") return;
    stopTraceTone();
    state.drawing = false;
    state.overlay = "pause";
    pauseOverlay.classList.remove("hidden");
    scoreOverlay.classList.add("hidden");
    focusFirst(pauseOverlay);
  }

  function showScore() {
    var pct = tracedPct();
    var pass = pct >= PASS_PCT;
    state.lastPct = pct;
    state.overlay = "score";
    scoreTitle.textContent = pass ? "TRACED" : "TRY AGAIN";
    scoreReadout.textContent = pct + "%";
    if (scoreDetail) {
      scoreDetail.textContent = pass
        ? "of the outline"
        : "Need 90% or higher to proceed";
    }
    if (nextBtn) nextBtn.classList.toggle("hidden", !pass);
    pauseOverlay.classList.add("hidden");
    scoreOverlay.classList.remove("hidden");
    saveBest(pct);
    focusFirst(scoreOverlay);
    requestAnimationFrame(function () {
      if (state.overlay === "score") focusFirst(scoreOverlay);
    });
    if (pass) sfxPass();
    else sfxFail();
  }

  function beginStroke(event) {
    if (currentScreen !== "play" || state.overlay) return;
    var fig = currentFigure();
    state.drawing = true;
    state.stroke = [];
    state.claimed = [];
    state.claimedCount = 0;
    addStrokePoint({ x: fig.start.x, y: fig.start.y });
    state.pencil = { x: fig.start.x, y: fig.start.y };
    state.lastPtr = { x: event.clientX, y: event.clientY };
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    startTraceTone();
  }

  function moveStroke(event) {
    if (!state.drawing || state.overlay) return;
    var dx = event.clientX - state.lastPtr.x;
    var dy = event.clientY - state.lastPtr.y;
    state.lastPtr = { x: event.clientX, y: event.clientY };
    var x = clamp(state.pencil.x + dx, 18, 582);
    var y = clamp(state.pencil.y + dy, HUD_TOP + 8, 582);
    var last = state.stroke[state.stroke.length - 1];
    var gap = Math.hypot(x - last.x, y - last.y);
    if (gap < 1.5) {
      state.pencil.x = x;
      state.pencil.y = y;
      setTraceTone(onOutline(state.pencil, currentFigure()));
      return;
    }
    var steps = Math.max(1, Math.round(gap / 8));
    var s;
    for (s = 1; s <= steps; s++) {
      var t = s / steps;
      var px = last.x + (x - last.x) * t;
      var py = last.y + (y - last.y) * t;
      addStrokePoint({ x: px, y: py });
    }
    state.pencil.x = x;
    state.pencil.y = y;
    setTraceTone(onOutline(state.pencil, currentFigure()));
  }

  function endStroke() {
    if (!state.drawing) return;
    stopTraceTone();
    state.drawing = false;
    state.lastPtr = null;
    suppressSelectUntil = Date.now() + ACTION_MS;
    sfxRelease();
    showScore();
  }

  function drawPath(pts, closed) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    var i;
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  function draw() {
    var fig = currentFigure();
    var t = Date.now() / 1000;
    ctx.clearRect(0, 0, 600, 600);

    ctx.strokeStyle = "#3a3d42";
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    drawPath(fig.path, fig.closed);

    ctx.strokeStyle = "#8b8f96";
    ctx.lineWidth = 6;
    drawPath(fig.path, fig.closed);

    var k;
    for (k = 0; k < fig.ticks.length; k++) {
      if (!state.claimed[k]) continue;
      ctx.beginPath();
      ctx.fillStyle = "#00ff88";
      ctx.arc(fig.ticks[k].x, fig.ticks[k].y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.stroke.length > 1) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 8;
      drawPath(state.stroke, false);
    }

    var startPulse = 8 + Math.sin(t * 4) * 3;
    ctx.beginPath();
    ctx.fillStyle = "#00e5ff";
    ctx.arc(fig.start.x, fig.start.y, startPulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(fig.start.x, fig.start.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (fig.path.length > 8) {
      var a = fig.path[0];
      var b = fig.path[Math.min(12, fig.path.length - 1)];
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + Math.cos(ang) * 36, a.y + Math.sin(ang) * 36);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(state.pencil.x, state.pencil.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 3;
    ctx.arc(state.pencil.x, state.pencil.y, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 22px ui-monospace, SF Mono, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText(fig.name, 20, 36);
    ctx.textAlign = "right";
    ctx.fillStyle = "#b0b3b8";
    ctx.fillText(state.figure + 1 + " / " + figures.length, 580, 36);

    var hint = "PINCH AND DRAG";
    if (state.drawing || state.overlay === "score") {
      hint = tracedPct() + "%";
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#e4e6eb";
    ctx.font = "700 18px ui-monospace, SF Mono, Menlo, monospace";
    ctx.fillText(hint, 300, 584);
  }

  function startLoop() {
    if (rafId) return;
    var tick = function () {
      if (currentScreen !== "play") {
        rafId = 0;
        return;
      }
      draw();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function handleAction(action) {
    var now = Date.now();
    if (action === lastActionName && now - lastActionAt < ACTION_MS) return;
    lastActionName = action;
    lastActionAt = now;
    if (action === "play") {
      ensureAudio();
      state.figure = 0;
      startRound();
      return;
    }
    if (action === "how") {
      navigateTo("how");
      return;
    }
    if (action === "home" || action === "quit") {
      hideOverlay();
      resetStroke();
      navigateTo("home");
      return;
    }
    if (action === "resume") {
      hideOverlay();
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      return;
    }
    if (action === "retry") {
      startRound();
      return;
    }
    if (action === "next") {
      if (state.lastPct < PASS_PCT) return;
      state.figure = (state.figure + 1) % figures.length;
      startRound();
    }
  }

  function hitFocusable(event) {
    var el =
      event.target && event.target.closest
        ? event.target.closest(".focusable")
        : null;
    return isFocusable(el) ? el : null;
  }

  function pointerNearRelease(event) {
    return (
      Math.hypot(event.clientX - lastRelease.x, event.clientY - lastRelease.y) <=
      TAP_PX + 12
    );
  }

  function trustedPointerHit(event) {
    if (pointerNearRelease(event)) return null;
    return hitFocusable(event);
  }

  function canDraw() {
    return currentScreen === "play" && !state.overlay;
  }

  document.addEventListener("focusin", function (event) {
    if (isFocusable(event.target)) lastFocusable = event.target;
  });

  document.addEventListener(
    "pointerdown",
    function (event) {
      event.preventDefault();
      ensureAudio();
      tap.active = true;
      tap.drawing = false;
      tap.moved = false;
      tap.x = event.clientX;
      tap.y = event.clientY;
      if (!canDraw()) {
        var hit = trustedPointerHit(event);
        if (hit) hit.focus();
      } else {
        tap.drawing = true;
        beginStroke(event);
      }
    },
    { passive: false }
  );
  document.addEventListener(
    "pointermove",
    function (event) {
      if (!tap.active && !state.drawing) return;
      event.preventDefault();
      if (
        Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_PX
      ) {
        tap.moved = true;
      }
      if (state.drawing) moveStroke(event);
    },
    { passive: false }
  );
  document.addEventListener(
    "pointerup",
    function (event) {
      event.preventDefault();
      var wasDrawing = state.drawing || tap.drawing;
      var moved = tap.moved;
      tap.active = false;
      tap.drawing = false;
      if (wasDrawing) {
        lastRelease.x = event.clientX;
        lastRelease.y = event.clientY;
        endStroke();
        return;
      }
      if (moved) return;
      if (state.overlay) {
        activateControl(focusedControl());
        return;
      }
      activateControl(trustedPointerHit(event) || focusedControl());
    },
    { passive: false }
  );
  document.addEventListener("pointercancel", function () {
    tap.active = false;
    tap.drawing = false;
    if (state.drawing) endStroke();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === DPAD.BACK || event.key === "Backspace") {
      if (currentScreen === "play" && state.overlay === "pause") {
        handleAction("resume");
        event.preventDefault();
        return;
      }
      if (currentScreen === "play") {
        showPause();
        event.preventDefault();
        return;
      }
      if (currentScreen === "how") {
        handleAction("home");
        event.preventDefault();
        return;
      }
    }
    if (currentScreen === "play" && !state.overlay) {
      if (event.key === DPAD.SELECT) {
        event.preventDefault();
        return;
      }
    }
    switch (event.key) {
      case DPAD.UP:
        moveFocus("up");
        break;
      case DPAD.DOWN:
        moveFocus("down");
        break;
      case DPAD.LEFT:
        moveFocus("left");
        break;
      case DPAD.RIGHT:
        moveFocus("right");
        break;
      case DPAD.SELECT:
        if (Date.now() < suppressSelectUntil) break;
        activateControl(focusedControl());
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  collectScreens();
  renderBest();
  focusFirst(screens.home);
})();
