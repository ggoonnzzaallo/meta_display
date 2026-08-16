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
  var CY = 318;
  var RING = 78;
  var SPAWN = 262;
  var HP_MAX = 5;
  var BEST_KEY = "cadence-best";
  var CYAN = "#00D4FF";
  var AMBER = "#FFB000";
  var RED = "#FF3333";
  var CREAM = "#FFFFFF";
  var MUTED = "#B0B3B8";
  var SURFACE = "#1C1E21";

  var DIRS = [
    { key: "ArrowUp", x: 0, y: -1, label: "UP" },
    { key: "ArrowRight", x: 1, y: 0, label: "RIGHT" },
    { key: "ArrowDown", x: 0, y: 1, label: "DOWN" },
    { key: "ArrowLeft", x: -1, y: 0, label: "LEFT" },
  ];

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var playBtn = document.getElementById("play-btn");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");

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

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var time = 0;
  var score = 0;
  var combo = 0;
  var hp = HP_MAX;
  var best = 0;
  var notes = [];
  var chart = [];
  var chartI = 0;
  var judge = "";
  var judgeT = 0;
  var flash = 0;

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
    var t = 1.35;
    var lastDir = -1;
    while (t < 78) {
      var dir = (Math.random() * 4) | 0;
      if (dir === lastDir) dir = (dir + 1 + ((Math.random() * 3) | 0)) % 4;
      var progress = (t - 1.35) / 76;
      out.push({
        t: t,
        dir: dir,
        travel: 1.32 - progress * 0.52,
      });
      t += 0.64 - progress * 0.3;
      lastDir = dir;
    }
    return out;
  }

  function notePos(note) {
    var p = (time - note.spawn) / note.travel;
    if (p < 0) p = 0;
    var dir = DIRS[note.dir];
    var r = SPAWN + (RING - SPAWN) * Math.min(p, 1.28);
    return { x: CX + dir.x * r, y: CY + dir.y * r, p: p };
  }

  function missNote() {
    combo = 0;
    hp -= 1;
    judge = "MISS";
    judgeT = 0.35;
    flash = 0.18;
    if (hp <= 0) endRun();
  }

  function hitNote(note, err) {
    note.hit = true;
    combo += 1;
    if (err <= 0.09) {
      score += 100 + combo * 4;
      judge = "PERFECT";
    } else {
      score += 50 + combo * 2;
      judge = "GOOD";
    }
    judgeT = 0.32;
  }

  function tryHit(dir) {
    var bestNote = null;
    var bestErr = 99;
    notes.forEach(function (note) {
      if (note.hit || note.missed || note.dir !== dir) return;
      var p = (time - note.spawn) / note.travel;
      var err = Math.abs(p - 1);
      if (err < bestErr) {
        bestErr = err;
        bestNote = note;
      }
    });
    if (bestNote && bestErr <= 0.2) {
      hitNote(bestNote, bestErr);
      return;
    }
    combo = 0;
    judge = "EARLY";
    judgeT = 0.22;
  }

  function startRun() {
    running = true;
    paused = false;
    score = 0;
    combo = 0;
    hp = HP_MAX;
    time = 0;
    notes = [];
    chart = buildChart();
    chartI = 0;
    judge = "";
    judgeT = 0;
    flash = 0;
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
      overStats.innerHTML = "SCORE " + pad(score, 5) + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function update(dt) {
    time += dt;
    if (judgeT > 0) judgeT -= dt;
    if (flash > 0) flash -= dt;

    while (chartI < chart.length && chart[chartI].t <= time) {
      var item = chart[chartI];
      notes.push({
        dir: item.dir,
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

  function drawChevron(x, y, dir, size, color) {
    var vx = DIRS[dir].x;
    var vy = DIRS[dir].y;
    var px = -vy;
    var py = vx;
    ctx.beginPath();
    ctx.moveTo(x - vx * size, y - vy * size);
    ctx.lineTo(x + px * size * 0.72, y + py * size * 0.72);
    ctx.lineTo(x + vx * size * 0.2, y + vy * size * 0.2);
    ctx.lineTo(x - px * size * 0.72, y - py * size * 0.72);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function incomingHint() {
    var nearest = null;
    var nearestP = -1;
    notes.forEach(function (note) {
      if (note.hit || note.missed) return;
      var p = (time - note.spawn) / note.travel;
      if (p > nearestP && p < 1.08) {
        nearestP = p;
        nearest = note;
      }
    });
    if (!nearest) return { line: "WAIT", sub: "An arrow will fly in" };
    return {
      line: "SWIPE " + DIRS[nearest.dir].label,
      sub: "When it reaches the ring",
    };
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = SURFACE;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(CX, CY, RING, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CX, CY, RING, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = "700 16px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = MUTED;
    ctx.fillText("UP", CX, CY - RING - 22);
    ctx.fillText("DOWN", CX, CY + RING + 22);
    ctx.fillText("LEFT", CX - RING - 36, CY);
    ctx.fillText("RIGHT", CX + RING + 40, CY);

    DIRS.forEach(function (dir, i) {
      drawChevron(CX + dir.x * (RING - 4), CY + dir.y * (RING - 4), i, 14, MUTED);
    });

    notes.forEach(function (note) {
      var pos = notePos(note);
      var color = note.hit ? CYAN : note.missed ? RED : CREAM;
      var size = note.hit ? 12 : 26;
      ctx.globalAlpha = note.hit ? 0.35 : note.missed ? 0.4 : 1;
      drawChevron(pos.x, pos.y, note.dir, size, color);
      if (!note.hit && !note.missed && pos.p > 0.15 && pos.p < 1.05) {
        ctx.fillStyle = color;
        ctx.font = "700 18px ui-monospace, monospace";
        ctx.fillText(DIRS[note.dir].label, pos.x - DIRS[note.dir].x * 36, pos.y - DIRS[note.dir].y * 36);
      }
      ctx.globalAlpha = 1;
    });

    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 51, 51, " + flash * 0.35 + ")";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("SCORE " + pad(score, 5), 28, 45);
    ctx.textAlign = "right";
    ctx.fillText("x" + combo, 572, 45);

    var i;
    for (i = 0; i < HP_MAX; i += 1) {
      ctx.fillStyle = i < hp ? CYAN : "#2A2D31";
      ctx.fillRect(220 + i * 32, 28, 24, 18);
    }

    var hint = incomingHint();
    ctx.fillStyle = SURFACE;
    ctx.fillRect(40, 500, 520, 72);
    ctx.textAlign = "center";
    ctx.fillStyle = CREAM;
    ctx.font = "700 26px ui-monospace, monospace";
    ctx.fillText(hint.line, CX, 532);
    ctx.fillStyle = MUTED;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText(hint.sub, CX, 556);

    if (judgeT > 0) {
      ctx.fillStyle = judge === "PERFECT" ? CYAN : judge === "GOOD" ? AMBER : RED;
      ctx.font = "700 28px ui-monospace, monospace";
      ctx.fillText(judge, CX, CY + 8);
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
    if (key === "enter") {
      focusPlay();
      return;
    }
    if (event.repeat) return;
    var dir = { up: 0, right: 1, down: 2, left: 3 }[key];
    if (dir != null) tryHit(dir);
    focusPlay();
  }

  function handleAction(action) {
    if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopLoop();
      navigateTo("home");
    } else if (action === "resume") resumeRun();
    else if (action === "hold") focusPlay();
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
