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

  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var bestEl = document.getElementById("best-readout");
  var pauseOverlay = document.getElementById("pause-overlay");
  var scoreOverlay = document.getElementById("score-overlay");
  var scoreTitle = document.getElementById("score-title");
  var scoreReadout = document.getElementById("score-readout");
  var scoreDetail = document.getElementById("score-detail");

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

  var screens = {};
  var currentScreen = "home";
  var rafId = 0;
  var figures = buildFigures();

  var state = {
    figure: 0,
    drawing: false,
    stroke: [],
    colors: [],
    pencil: { x: 300, y: 300 },
    lastPtr: null,
    live: null,
    result: null,
    overlay: "",
    best: loadBest(),
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

  function polylineLen(pts, closed) {
    var n = pts.length;
    if (n < 2) return 0;
    var segs = closed ? n : n - 1;
    var len = 0;
    var i;
    for (i = 0; i < segs; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % n];
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return len;
  }

  function makeFigure(name, pts, closed) {
    var path = densify(pts, closed, 4);
    return {
      name: name,
      closed: closed,
      path: path,
      ticks: ticksFrom(path, closed),
      start: path[0],
      length: polylineLen(path, closed),
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

  function infinity(cx, cy, rx, ry) {
    var pts = [];
    var i;
    var n = 80;
    for (i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2;
      pts.push({
        x: cx + rx * Math.sin(t),
        y: cy + ry * Math.sin(t) * Math.cos(t),
      });
    }
    return pts;
  }

  function buildFigures() {
    var cx = 300;
    var cy = 318;
    return [
      makeFigure("LINE", [{ x: 90, y: 320 }, { x: 510, y: 320 }], false),
      makeFigure("TRIANGLE", poly(3, cx, cy + 18, 186, -Math.PI / 2), true),
      makeFigure("SQUARE", poly(4, cx, cy, 168, Math.PI / 4), true),
      makeFigure("HOUSE", house(cx, cy + 8, 280, 260), true),
      makeFigure("CIRCLE", ellipse(cx, cy, 168, 168, 48), true),
      makeFigure("HEART", heart(cx, cy + 8, 11.2), true),
      makeFigure("STAR", star(cx, cy, 176, 78, 5), true),
      makeFigure("LOOP", infinity(cx, cy, 190, 110), true),
    ];
  }

  function currentFigure() {
    return figures[state.figure % figures.length];
  }

  function distToSeg(p, a, b) {
    var abx = b.x - a.x;
    var aby = b.y - a.y;
    var len2 = abx * abx + aby * aby;
    var t = len2 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    t = clamp(t, 0, 1);
    var qx = a.x + abx * t;
    var qy = a.y + aby * t;
    return Math.hypot(p.x - qx, p.y - qy);
  }

  function distToPath(p, fig) {
    var pts = fig.path;
    var n = pts.length;
    var segs = fig.closed ? n : n - 1;
    var best = Infinity;
    var i;
    for (i = 0; i < segs; i++) {
      var d = distToSeg(p, pts[i], pts[(i + 1) % n]);
      if (d < best) best = d;
    }
    return best;
  }

  function inkColor(dist) {
    if (dist < 10) return "#00ff88";
    if (dist < 22) return "#ffd23f";
    return "#ff4466";
  }

  function skillLabel(pct) {
    if (pct >= 96) return "ARTIST";
    if (pct >= 88) return "ADULT";
    if (pct >= 75) return "12-YEAR-OLD";
    if (pct >= 62) return "10-YEAR-OLD";
    if (pct >= 48) return "8-YEAR-OLD";
    if (pct >= 34) return "6-YEAR-OLD";
    if (pct >= 18) return "4-YEAR-OLD";
    return "TODDLER";
  }

  function scoreStroke() {
    var fig = currentFigure();
    var stroke = state.stroke;
    if (stroke.length < 6) {
      return { score: 0, coverage: 0, onPath: 0, grade: "TODDLER" };
    }
    var onPath = 0;
    var inkLen = 0;
    var i;
    for (i = 0; i < stroke.length; i++) {
      if (distToPath(stroke[i], fig) <= COVER_DIST) onPath += 1;
      if (i > 0) {
        inkLen += Math.hypot(
          stroke[i].x - stroke[i - 1].x,
          stroke[i].y - stroke[i - 1].y
        );
      }
    }
    var onPathFrac = onPath / stroke.length;
    var ticks = fig.ticks;
    var hit = 0;
    for (i = 0; i < ticks.length; i++) {
      var t = ticks[i];
      var j;
      for (j = 0; j < stroke.length; j++) {
        if (distToPath(stroke[j], fig) > COVER_DIST) continue;
        if (Math.hypot(stroke[j].x - t.x, stroke[j].y - t.y) <= COVER_DIST) {
          hit += 1;
          break;
        }
      }
    }
    var coverage = ticks.length ? hit / ticks.length : 0;
    var pathLen = Math.max(1, fig.length);
    var efficiency = 1;
    if (inkLen > pathLen * 1.6) efficiency = (pathLen * 1.6) / inkLen;
    var traced = coverage * onPathFrac * efficiency;
    var score = Math.round(100 * traced);
    if (onPathFrac < 0.2) score = Math.min(score, 16);
    return {
      score: score,
      coverage: coverage,
      onPath: onPathFrac,
      grade: skillLabel(score),
    };
  }

  function resetStroke() {
    var fig = currentFigure();
    state.drawing = false;
    state.stroke = [];
    state.colors = [];
    state.pencil = { x: fig.start.x, y: fig.start.y };
    state.lastPtr = null;
    state.live = null;
    state.result = null;
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
    state.drawing = false;
    state.overlay = "pause";
    pauseOverlay.classList.remove("hidden");
    scoreOverlay.classList.add("hidden");
    focusFirst(pauseOverlay);
  }

  function showScore(result) {
    state.result = result;
    state.overlay = "score";
    scoreTitle.textContent = result.grade;
    scoreReadout.textContent = result.score + "%";
    if (scoreDetail) {
      scoreDetail.textContent = "of the outline traced";
    }
    pauseOverlay.classList.add("hidden");
    scoreOverlay.classList.remove("hidden");
    saveBest(result.score);
    focusFirst(scoreOverlay);
  }

  function beginStroke(event) {
    if (currentScreen !== "play" || state.overlay) return;
    var fig = currentFigure();
    state.drawing = true;
    state.stroke = [{ x: fig.start.x, y: fig.start.y }];
    state.colors = [inkColor(0)];
    state.pencil = { x: fig.start.x, y: fig.start.y };
    state.lastPtr = { x: event.clientX, y: event.clientY };
    state.live = { score: 100, accuracy: 1, coverage: 0, grade: "" };
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
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
      return;
    }
    var steps = Math.max(1, Math.round(gap / 4));
    var s;
    for (s = 1; s <= steps; s++) {
      var t = s / steps;
      var px = last.x + (x - last.x) * t;
      var py = last.y + (y - last.y) * t;
      var pt = { x: px, y: py };
      state.stroke.push(pt);
      state.colors.push(inkColor(distToPath(pt, currentFigure())));
    }
    state.pencil.x = x;
    state.pencil.y = y;
    state.live = scoreStroke();
  }

  function endStroke() {
    if (!state.drawing) return;
    state.drawing = false;
    state.lastPtr = null;
    suppressSelectUntil = Date.now() + ACTION_MS;
    showScore(scoreStroke());
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

    var claimed = {};
    if (state.stroke.length) {
      var i;
      for (i = 0; i < fig.ticks.length; i++) {
        var tick = fig.ticks[i];
        var j;
        for (j = 0; j < state.stroke.length; j++) {
          if (
            Math.hypot(state.stroke[j].x - tick.x, state.stroke[j].y - tick.y) <=
            COVER_DIST
          ) {
            claimed[i] = true;
            break;
          }
        }
      }
    }
    var k;
    for (k = 0; k < fig.ticks.length; k++) {
      ctx.beginPath();
      ctx.fillStyle = claimed[k] ? "#00ff88" : "#5c6168";
      ctx.arc(fig.ticks[k].x, fig.ticks[k].y, claimed[k] ? 3.5 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.stroke.length > 1) {
      var s;
      for (s = 1; s < state.stroke.length; s++) {
        ctx.beginPath();
        ctx.strokeStyle = state.colors[s] || "#ffffff";
        ctx.lineWidth = 8;
        ctx.moveTo(state.stroke[s - 1].x, state.stroke[s - 1].y);
        ctx.lineTo(state.stroke[s].x, state.stroke[s].y);
        ctx.stroke();
      }
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
    if (state.drawing && state.live) hint = state.live.score + "% TRACED";
    if (state.overlay === "score" && state.result) {
      hint = state.result.score + "% TRACED";
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
      state.figure = (state.figure + 1) % figures.length;
      startRound();
    }
  }

  function hitFocusable(event) {
    return event.target && event.target.closest
      ? event.target.closest(".focusable")
      : null;
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
      tap.active = true;
      tap.drawing = false;
      tap.moved = false;
      tap.x = event.clientX;
      tap.y = event.clientY;
      if (canDraw()) {
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
        endStroke();
        return;
      }
      if (moved) return;
      activateControl(hitFocusable(event) || focusedControl());
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
