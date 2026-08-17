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

  var SIZE = 600;
  var CX = 300;
  var HP_MAX = 5;
  var BEST_KEY = "apex-best";
  var RED = "#FF3B3B";
  var AMBER = "#FFB000";
  var CYAN = "#00D4FF";
  var CREAM = "#FFFFFF";
  var MUTED = "#B0B3B8";
  var SURFACE = "#1C1E21";
  var GREEN = "#00FF88";

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var playBtn = document.getElementById("play-btn");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var time = 0;
  var phase = "lights";
  var score = 0;
  var combo = 0;
  var hp = HP_MAX;
  var best = 0;
  var lights = 0;
  var lightT = 0;
  var goAt = 0;
  var jumped = false;
  var notes = [];
  var chart = [];
  var chartI = 0;
  var judge = "";
  var judgePts = "";
  var judgeT = 0;
  var flash = 0;
  var perfects = 0;
  var lates = 0;
  var earlies = 0;
  var reactionMs = 0;

  function playKey(event) {
    var k = event.key;
    var c = event.keyCode;
    if (k === "ArrowUp" || k === "Up" || c === 38) return "up";
    if (k === "ArrowDown" || k === "Down" || c === 40) return "down";
    if (k === "ArrowLeft" || k === "Left" || c === 37) return "left";
    if (k === "ArrowRight" || k === "Right" || c === 39) return "right";
    if (k === "Enter" || c === 13) return "enter";
    if (k === "Escape" || c === 27) return "escape";
    return "";
  }

  function focusPlay() {
    if (playBtn) playBtn.focus();
  }

  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = "0" + s;
    return s;
  }

  function readBest() {
    try {
      return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function writeBest(value) {
    try {
      localStorage.setItem(BEST_KEY, String(value));
    } catch (err) {}
  }

  function updateBestReadout() {
    if (bestReadout) bestReadout.textContent = "BEST " + pad(best, 5);
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

  function focusRoot() {
    if (currentScreen === "play" && paused) return pauseOverlay;
    return screens[currentScreen];
  }

  function navigateTo(screenId) {
    Object.keys(screens).forEach(function (id) {
      screens[id].classList.add("hidden");
    });
    if (!screens[screenId]) return;
    screens[screenId].classList.remove("hidden");
    currentScreen = screenId;
    if (screenId === "play") focusPlay();
    else focusFirst(screens[screenId]);
  }

  function moveFocus(direction) {
    var container = focusRoot();
    if (!container) return;
    var focusables = Array.from(
      container.querySelectorAll(".focusable:not([disabled]):not(.hidden)")
    );
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

  function buildChart() {
    var out = [];
    var t = 0.9;
    var last = "";
    while (t < 78) {
      var progress = t / 78;
      var ease = progress * progress;
      var roll = Math.random();
      var kind = roll < 0.34 ? "B" : roll < 0.67 ? "L" : "R";
      if (kind === last) kind = kind === "B" ? (Math.random() < 0.5 ? "L" : "R") : "B";
      out.push({
        t: t,
        kind: kind,
        travel: 2.2 - ease * 1.05,
      });
      t += 1.22 - ease * 0.7;
      last = kind;
    }
    return out;
  }

  function missNote() {
    combo = 0;
    hp -= 1;
    judge = "MISS";
    judgePts = "+0";
    judgeT = 0.4;
    flash = 0.18;
    if (hp <= 0) endRun();
  }

  function hitNote(note, err, p) {
    note.hit = true;
    combo += 1;
    var gained = 0;
    if (err <= 0.07) {
      gained = 300 + combo * 12;
      judge = "PERFECT";
      perfects += 1;
    } else if (p < 1) {
      gained = 80 + combo * 3;
      judge = "EARLY";
      earlies += 1;
    } else {
      gained = 110 + combo * 4;
      judge = "LATE";
      lates += 1;
    }
    score += gained;
    judgePts = "+" + gained;
    judgeT = 0.5;
  }

  function tryHit(kind) {
    if (phase !== "lap") return;
    var bestNote = null;
    var bestErr = 99;
    var bestP = 0;
    notes.forEach(function (note) {
      if (note.hit || note.missed || note.kind !== kind) return;
      var p = (time - note.spawn) / note.travel;
      var err = Math.abs(p - 1);
      if (err < bestErr) {
        bestErr = err;
        bestNote = note;
        bestP = p;
      }
    });
    if (bestNote && bestErr <= 0.22) {
      hitNote(bestNote, bestErr, bestP);
      return;
    }
    combo = 0;
    judge = "WHIFF";
    judgePts = "+0";
    judgeT = 0.28;
  }

  function beginLap() {
    phase = "lap";
    time = 0;
    notes = [];
    chart = buildChart();
    chartI = 0;
    lastTs = 0;
  }

  function lightsPinch() {
    if (phase !== "lights" || jumped) return;
    if (goAt <= 0) {
      jumped = true;
      hp -= 1;
      judge = "JUMP START";
      judgePts = "-1 LIFE";
      judgeT = 0.8;
      flash = 0.22;
      if (hp <= 0) {
        endRun();
        return;
      }
      beginLap();
      return;
    }
    reactionMs = Math.max(0, (time - goAt) * 1000);
    var gained = Math.max(80, Math.round(700 - reactionMs * 1.6));
    score += gained;
    judge = "LIGHTS OUT";
    judgePts = reactionMs.toFixed(0) + " ms  +" + gained;
    judgeT = 0.9;
    beginLap();
  }

  function startRun() {
    running = true;
    paused = false;
    score = 0;
    combo = 0;
    hp = HP_MAX;
    time = 0;
    phase = "lights";
    lights = 0;
    lightT = 0.55;
    goAt = 0;
    jumped = false;
    notes = [];
    chart = [];
    chartI = 0;
    judge = "";
    judgePts = "";
    judgeT = 0;
    flash = 0;
    perfects = 0;
    lates = 0;
    earlies = 0;
    reactionMs = 0;
    lastTs = 0;
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    loop();
  }

  function pauseRun() {
    if (!running || paused) return;
    paused = true;
    pauseOverlay.classList.remove("hidden");
    focusFirst(pauseOverlay);
  }

  function resumeRun() {
    if (!running || !paused) return;
    paused = false;
    lastTs = 0;
    pauseOverlay.classList.add("hidden");
    focusPlay();
  }

  function stopLoop() {
    running = false;
    paused = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pauseOverlay.classList.add("hidden");
  }

  function endRun() {
    if (!running) return;
    if (score > best) {
      best = score;
      writeBest(best);
      updateBestReadout();
    }
    stopLoop();
    if (overStats) {
      overStats.innerHTML =
        "SCORE " +
        pad(score, 5) +
        "<br>PERFECT " +
        pad(perfects, 3) +
        "<br>REACT " +
        (reactionMs ? reactionMs.toFixed(0) + " ms" : jumped ? "JUMP" : "--") +
        "<br>BEST " +
        pad(best, 5);
    }
    navigateTo("over");
  }

  function updateLights(dt) {
    lightT -= dt;
    if (lights < 5) {
      if (lightT <= 0) {
        lights += 1;
        lightT = lights >= 5 ? 0.3 + Math.random() * 2.4 : 0.62;
      }
      return;
    }
    if (goAt <= 0) {
      if (lightT <= 0) {
        goAt = time;
        lights = 0;
      }
      return;
    }
    if (time - goAt > 1.15) {
      judge = "ASLEEP";
      judgePts = "+0";
      judgeT = 0.6;
      missNote();
      if (running) beginLap();
    }
  }

  function updateLap(dt) {
    while (chartI < chart.length && chart[chartI].t <= time) {
      var item = chart[chartI];
      notes.push({
        kind: item.kind,
        spawn: time,
        travel: item.travel,
        hit: false,
        missed: false,
      });
      chartI += 1;
    }
    notes.forEach(function (note) {
      if (note.hit || note.missed) return;
      var p = (time - note.spawn) / note.travel;
      if (p > 1.22) {
        note.missed = true;
        missNote();
      }
    });
    notes = notes.filter(function (note) {
      return time - note.spawn < note.travel * 1.45;
    });
    if (chartI >= chart.length && !notes.length && hp > 0) endRun();
  }

  function update(dt) {
    time += dt;
    if (judgeT > 0) judgeT -= dt;
    if (flash > 0) flash -= dt;
    if (phase === "lights") updateLights(dt);
    else updateLap(dt);
  }

  function drawRoad() {
    ctx.fillStyle = "#121417";
    ctx.beginPath();
    ctx.moveTo(CX, 92);
    ctx.lineTo(520, 560);
    ctx.lineTo(80, 560);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CX, 92);
    ctx.lineTo(80, 560);
    ctx.moveTo(CX, 92);
    ctx.lineTo(520, 560);
    ctx.stroke();
    ctx.strokeStyle = AMBER;
    ctx.setLineDash([18, 16]);
    ctx.beginPath();
    ctx.moveTo(CX, 110);
    ctx.lineTo(CX, 548);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(118, 430);
    ctx.lineTo(482, 430);
    ctx.stroke();
  }

  function noteScale(p) {
    return 0.12 + Math.min(1.15, Math.max(0, p)) * 0.88;
  }

  function drawChevron(x, y, dir, size, color) {
    var vx = dir;
    ctx.beginPath();
    ctx.moveTo(x + vx * size, y);
    ctx.lineTo(x - vx * size * 0.35, y - size * 0.7);
    ctx.lineTo(x - vx * size * 0.05, y);
    ctx.lineTo(x - vx * size * 0.35, y + size * 0.7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawNote(note) {
    var p = (time - note.spawn) / note.travel;
    var y = 120 + Math.min(1.2, Math.max(0, p)) * 310;
    var s = noteScale(p);
    var inWindow = p > 0.86 && p < 1.12;
    var color = note.hit ? CYAN : note.missed ? RED : inWindow ? (note.kind === "B" ? RED : CYAN) : CREAM;
    ctx.globalAlpha = note.hit ? 0.3 : note.missed ? 0.35 : 1;
    if (note.kind === "B") {
      var w = 40 + s * 220;
      ctx.fillStyle = color;
      ctx.fillRect(CX - w / 2, y - 7 * s, w, 14 * s);
    } else {
      var x = note.kind === "L" ? CX - 70 * s : CX + 70 * s;
      drawChevron(x, y, note.kind === "L" ? -1 : 1, 18 + s * 16, color);
    }
    ctx.globalAlpha = 1;
  }

  function drawLights() {
    var i;
    var on = phase === "lights" && lights > 0 && goAt <= 0;
    for (i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(140 + i * 80, 78, 18, 0, Math.PI * 2);
      ctx.fillStyle = on && i < lights ? RED : "#2A2D31";
      ctx.fill();
      if (on && i < lights) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawHud() {
    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("SCORE " + pad(score, 5), 28, 45);
    ctx.fillStyle = CYAN;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText("PERF " + pad(perfects, 3), 210, 45);
    ctx.textAlign = "right";
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.fillText("x" + combo, 572, 45);
    var i;
    for (i = 0; i < HP_MAX; i += 1) {
      ctx.fillStyle = i < hp ? RED : "#2A2D31";
      ctx.fillRect(320 + i * 28, 28, 20, 16);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawRoad();
    drawLights();
    if (phase === "lap") notes.forEach(drawNote);
    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 59, 59, " + flash * 0.4 + ")";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    drawHud();
    if (phase === "lights" && goAt <= 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = MUTED;
      ctx.font = "700 16px ui-monospace, monospace";
      ctx.fillText(lights < 5 ? "WAIT" : "PINCH ON LIGHTS OUT", CX, 390);
    }
    if (judgeT > 0) {
      ctx.textAlign = "center";
      ctx.fillStyle =
        judge === "PERFECT" || judge === "LIGHTS OUT"
          ? GREEN
          : judge === "LATE" || judge === "EARLY"
            ? AMBER
            : RED;
      ctx.font = "700 30px ui-monospace, monospace";
      ctx.fillText(judge, CX, 250);
      ctx.font = "700 18px ui-monospace, monospace";
      ctx.fillStyle = CREAM;
      ctx.fillText(judgePts, CX, 282);
    }
    ctx.textAlign = "left";
  }

  function loop(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (paused) return;
    if (!lastTs) lastTs = ts || performance.now();
    var now = ts || performance.now();
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;
    update(dt);
    draw();
  }

  function handlePlayKey(event) {
    var key = playKey(event);
    if (key === "escape") {
      pauseRun();
      return;
    }
    if (event.repeat) return;
    if (phase === "lights") {
      if (key === "enter") lightsPinch();
      focusPlay();
      return;
    }
    if (key === "left" || key === "up") tryHit("L");
    else if (key === "right" || key === "down") tryHit("R");
    else if (key === "enter") tryHit("B");
    focusPlay();
  }

  function handleAction(action) {
    if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopLoop();
      navigateTo("home");
    } else if (action === "resume") resumeRun();
    else if (action === "hold") {
      if (currentScreen === "play" && running && !paused && phase === "lights") lightsPinch();
      else focusPlay();
    }
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "play" && running && !paused) {
      handlePlayKey(event);
      event.preventDefault();
      return;
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
        if (document.activeElement && document.activeElement.classList.contains("focusable")) {
          document.activeElement.click();
        }
        break;
      case DPAD.BACK:
        if (currentScreen === "play" && paused) resumeRun();
        else if (currentScreen !== "home") {
          stopLoop();
          navigateTo("home");
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    handleAction(button.getAttribute("data-action"));
  });

  collectScreens();
  best = readBest();
  updateBestReadout();
  focusFirst(screens.home);
})();
