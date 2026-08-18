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
  var GREEN = "#00FF88";
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
    var k = String(event.key || "");
    var code = String(event.code || "");
    var c = event.keyCode || event.which || 0;
    var token = (k + " " + code).toLowerCase();
    if (c === 38 || token.indexOf("arrowup") !== -1 || token.indexOf("uparrow") !== -1 || k.toLowerCase() === "up") {
      return "up";
    }
    if (c === 40 || token.indexOf("arrowdown") !== -1 || token.indexOf("downarrow") !== -1 || k.toLowerCase() === "down") {
      return "down";
    }
    if (c === 37 || token.indexOf("arrowleft") !== -1 || token.indexOf("leftarrow") !== -1 || k.toLowerCase() === "left") {
      return "left";
    }
    if (c === 39 || token.indexOf("arrowright") !== -1 || token.indexOf("rightarrow") !== -1 || k.toLowerCase() === "right") {
      return "right";
    }
    if (k === "Enter" || code === "Enter" || c === 13) return "enter";
    if (k === "Escape" || code === "Escape" || c === 27) return "escape";
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
  var judgePts = "";
  var judgeT = 0;
  var flash = 0;
  var perfects = 0;
  var goods = 0;
  var heldDirs = { 0: false, 1: false, 2: false, 3: false };
  var lastSwipeAt = 0;
  var lastSwipeDir = -1;
  var bursts = [];

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

  function setInert(el, inert) {
    if (!el) return;
    if (inert) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }

  function setPauseOpen(open) {
    if (!pauseOverlay) return;
    pauseOverlay.classList.toggle("hidden", !open);
    setInert(pauseOverlay, !open);
    pauseOverlay.querySelectorAll(".focusable").forEach(function (el) {
      if (open) el.removeAttribute("tabindex");
      else el.setAttribute("tabindex", "-1");
    });
  }

  function navigateTo(screenId) {
    Object.keys(screens).forEach(function (id) {
      screens[id].classList.add("hidden");
      setInert(screens[id], true);
    });
    if (!screens[screenId]) return;
    screens[screenId].classList.remove("hidden");
    setInert(screens[screenId], false);
    currentScreen = screenId;
    if (screenId === "play") {
      setPauseOpen(false);
      focusPlay();
    } else focusFirst(screens[screenId]);
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
    judgePts = "";
    judgeT = 0.35;
    flash = 0.18;
    spawnBurst(CX, CY, RED, 8);
    if (hp <= 0) endRun();
  }

  function hitNote(note, err) {
    note.hit = true;
    combo += 1;
    var gained = 0;
    if (err <= 0.09) {
      gained = 100 + combo * 4;
      judge = "PERFECT";
      perfects += 1;
    } else {
      gained = 50 + combo * 2;
      judge = "GOOD";
      goods += 1;
    }
    score += gained;
    judgePts = "+" + gained;
    judgeT = 0.32;
    spawnBurst(
      CX + DIRS[note.dir].x * RING,
      CY + DIRS[note.dir].y * RING,
      err <= 0.09 ? GREEN : CYAN,
      err <= 0.09 ? 12 : 8
    );
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
    judgePts = "";
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
    judgePts = "";
    judgeT = 0;
    flash = 0;
    perfects = 0;
    goods = 0;
    lastTs = 0;
    heldDirs = { 0: false, 1: false, 2: false, 3: false };
    lastSwipeAt = 0;
    lastSwipeDir = -1;
    bursts = [];
    navigateTo("play");
    loop();
  }

  function pauseRun() {
    if (!running || paused) return;
    paused = true;
    setPauseOpen(true);
    focusFirst(pauseOverlay);
  }

  function resumeRun() {
    if (!running || !paused) return;
    paused = false;
    lastTs = 0;
    setPauseOpen(false);
    focusPlay();
  }

  function stopLoop() {
    running = false;
    paused = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    setPauseOpen(false);
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
        "  GOOD " +
        pad(goods, 3) +
        "<br>BEST " +
        pad(best, 5);
    }
    navigateTo("over");
  }

  function update(dt) {
    time += dt;
    if (judgeT > 0) judgeT -= dt;
    if (flash > 0) flash -= dt;
    updateBursts(dt);

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

  function spawnBurst(x, y, color, n) {
    var i;
    for (i = 0; i < n; i += 1) {
      var a = (Math.PI * 2 * i) / n + Math.random() * 0.35;
      var spd = 60 + Math.random() * 110;
      bursts.push({
        x: x,
        y: y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        t: 0.34,
        max: 0.34,
        color: color,
      });
    }
  }

  function updateBursts(dt) {
    bursts.forEach(function (b) {
      b.t -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    });
    bursts = bursts.filter(function (b) {
      return b.t > 0;
    });
  }

  function setGlow(color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function clearGlow() {
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function chevronPath(x, y, dir, size) {
    var vx = DIRS[dir].x;
    var vy = DIRS[dir].y;
    var px = -vy;
    var py = vx;
    ctx.beginPath();
    ctx.moveTo(x - vx * size, y - vy * size);
    ctx.lineTo(x + px * size * 0.72, y + py * size * 0.72);
    ctx.lineTo(x + vx * size * 0.22, y + vy * size * 0.22);
    ctx.lineTo(x - px * size * 0.72, y - py * size * 0.72);
    ctx.closePath();
  }

  function drawChevron(x, y, dir, size, color, glow) {
    var prev = ctx.globalAlpha;
    chevronPath(x, y, dir, size);
    if (glow) setGlow(color, glow);
    ctx.fillStyle = color;
    ctx.globalAlpha = prev;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * 0.08);
    ctx.strokeStyle = CREAM;
    ctx.globalAlpha = prev * 0.55;
    ctx.stroke();
    ctx.globalAlpha = prev;
    clearGlow();
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
    return nearest;
  }

  function drawLane(dir, hot) {
    var x0 = CX + dir.x * (RING + 16);
    var y0 = CY + dir.y * (RING + 16);
    var x1 = CX + dir.x * (SPAWN - 6);
    var y1 = CY + dir.y * (SPAWN - 6);
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash(hot ? [] : [8, 14]);
    ctx.strokeStyle = hot ? "rgba(0, 212, 255, 0.55)" : "rgba(180, 190, 200, 0.28)";
    ctx.lineWidth = hot ? 9 : 3;
    if (hot) setGlow(CYAN, 12);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    clearGlow();
    ctx.restore();
  }

  function drawRing(nearest) {
    var perfect = judgeT > 0 && judge === "PERFECT";
    var ringColor = perfect ? GREEN : CYAN;
    var pulse = 1 + Math.sin(time * 5.2) * 0.012;
    var r = RING * pulse;

    ctx.beginPath();
    ctx.arc(CX, CY, r + 16, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 212, 255, 0.12)";
    ctx.lineWidth = 10;
    ctx.stroke();

    setGlow(ringColor, perfect ? 22 : 14);
    ctx.beginPath();
    ctx.arc(CX, CY, r, 0, Math.PI * 2);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 5;
    ctx.stroke();
    clearGlow();

    ctx.beginPath();
    ctx.arc(CX, CY, r - 9, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CX, CY, 5, 0, Math.PI * 2);
    ctx.fillStyle = ringColor;
    setGlow(ringColor, 10);
    ctx.fill();
    clearGlow();

    DIRS.forEach(function (dir, i) {
      var hot = nearest && nearest.dir === i;
      var tick0 = RING + 10;
      var tick1 = RING + 22;
      ctx.beginPath();
      ctx.moveTo(CX + dir.x * tick0, CY + dir.y * tick0);
      ctx.lineTo(CX + dir.x * tick1, CY + dir.y * tick1);
      ctx.strokeStyle = hot ? CYAN : "rgba(176, 179, 184, 0.7)";
      ctx.lineWidth = hot ? 4 : 2;
      ctx.stroke();
      drawChevron(
        CX + dir.x * (RING - 2),
        CY + dir.y * (RING - 2),
        i,
        hot ? 17 : 14,
        hot ? CYAN : MUTED,
        hot ? 10 : 0
      );
    });

    ctx.fillStyle = MUTED;
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("UP", CX, CY - RING - 30);
    ctx.fillText("DOWN", CX, CY + RING + 30);
    ctx.fillText("LEFT", CX - RING - 38, CY);
    ctx.fillText("RIGHT", CX + RING + 42, CY);
  }

  function drawNote(note) {
    var pos = notePos(note);
    var inWindow = pos.p > 0.9 && pos.p < 1.1;
    var color = note.hit ? CYAN : note.missed ? RED : inWindow ? CYAN : CREAM;
    var size = note.hit ? 12 : inWindow ? 30 : 18 + pos.p * 8;
    var trail;
    if (!note.hit && !note.missed && pos.p > 0.12) {
      for (trail = 2; trail >= 1; trail -= 1) {
        var tp = Math.max(0, pos.p - trail * 0.07);
        var tr = SPAWN + (RING - SPAWN) * Math.min(tp, 1.28);
        var dir = DIRS[note.dir];
        ctx.globalAlpha = 0.16 * trail;
        drawChevron(CX + dir.x * tr, CY + dir.y * tr, note.dir, size * (0.7 + trail * 0.08), color, 0);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = note.hit ? 0.3 : note.missed ? 0.35 : 1;
    drawChevron(pos.x, pos.y, note.dir, size, color, inWindow && !note.hit ? 16 : 0);
    ctx.globalAlpha = 1;
  }

  function drawBursts() {
    bursts.forEach(function (b) {
      var a = Math.max(0, b.t / b.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2 + (1 - a) * 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawHud(nearest) {
    roundRect(16, 16, 568, 48, 12);
    ctx.fillStyle = "rgba(28, 30, 33, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 212, 255, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("SCORE " + pad(score, 5), 32, 47);
    ctx.fillStyle = CYAN;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText("PERF " + pad(perfects, 3), 214, 47);
    ctx.textAlign = "right";
    ctx.fillStyle = combo > 4 ? GREEN : CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    if (combo > 4) setGlow(GREEN, 8);
    ctx.fillText("x" + combo, 568, 47);
    clearGlow();

    var i;
    for (i = 0; i < HP_MAX; i += 1) {
      var lx = 332 + i * 26;
      ctx.beginPath();
      ctx.moveTo(lx + 8, 28);
      ctx.lineTo(lx + 16, 36);
      ctx.lineTo(lx + 8, 44);
      ctx.lineTo(lx, 36);
      ctx.closePath();
      ctx.fillStyle = i < hp ? CYAN : "rgba(42, 45, 49, 0.9)";
      if (i < hp) setGlow(CYAN, 6);
      ctx.fill();
      clearGlow();
    }

    var hint = nearest
      ? { line: "SWIPE " + DIRS[nearest.dir].label, sub: "When it reaches the ring" }
      : { line: "WAIT", sub: "An arrow will fly in" };
    roundRect(40, 500, 520, 76, 14);
    ctx.fillStyle = "rgba(28, 30, 33, 0.92)";
    ctx.fill();
    ctx.strokeStyle = nearest ? "rgba(0, 212, 255, 0.55)" : "rgba(176, 179, 184, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (nearest) {
      drawChevron(92, 538, nearest.dir, 16, CYAN, 8);
    }
    ctx.textAlign = "center";
    ctx.fillStyle = CREAM;
    ctx.font = "700 26px ui-monospace, monospace";
    ctx.fillText(hint.line, CX + (nearest ? 10 : 0), 534);
    ctx.fillStyle = MUTED;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText(hint.sub, CX, 560);
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    var nearest = incomingHint();
    DIRS.forEach(function (dir, i) {
      drawLane(dir, nearest && nearest.dir === i);
    });
    drawRing(nearest);
    notes.forEach(drawNote);
    drawBursts();

    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 51, 51, " + flash * 0.32 + ")";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    drawHud(nearest);

    if (judgeT > 0) {
      var jColor = judge === "PERFECT" ? CYAN : judge === "GOOD" ? AMBER : RED;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      setGlow(jColor, 16);
      ctx.fillStyle = jColor;
      ctx.font = "700 32px ui-monospace, monospace";
      ctx.fillText(judge, CX, CY + 8);
      clearGlow();
      if (judgePts) {
        ctx.font = "700 18px ui-monospace, monospace";
        ctx.fillStyle = judge === "PERFECT" ? CYAN : CREAM;
        ctx.fillText(judgePts, CX, CY + 34);
      }
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
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

  function swipeDir(key) {
    return { up: 0, right: 1, down: 2, left: 3 }[key];
  }

  function registerSwipe(dir) {
    var now = performance.now();
    if (dir === lastSwipeDir && now - lastSwipeAt < 140) return;
    lastSwipeDir = dir;
    lastSwipeAt = now;
    tryHit(dir);
    focusPlay();
  }

  function handlePlayKey(event, isKeyUp) {
    var key = playKey(event);
    if (!key) return;
    if (key === "escape") {
      if (!isKeyUp) pauseRun();
      return;
    }
    if (key === "enter") {
      if (!isKeyUp) focusPlay();
      return;
    }
    var dir = swipeDir(key);
    if (dir == null) return;
    if (isKeyUp) {
      if (!heldDirs[dir]) registerSwipe(dir);
      heldDirs[dir] = false;
      return;
    }
    if (heldDirs[dir]) return;
    heldDirs[dir] = true;
    registerSwipe(dir);
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

  function onKeyDown(event) {
    if (currentScreen === "play" && running && !paused) {
      handlePlayKey(event, false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    var key = playKey(event);
    switch (key || event.key) {
      case "up":
      case DPAD.UP:
        moveFocus("up");
        break;
      case "down":
      case DPAD.DOWN:
        moveFocus("down");
        break;
      case "left":
      case DPAD.LEFT:
        moveFocus("left");
        break;
      case "right":
      case DPAD.RIGHT:
        moveFocus("right");
        break;
      case "enter":
      case DPAD.SELECT:
        if (document.activeElement && document.activeElement.classList.contains("focusable")) {
          document.activeElement.click();
        }
        break;
      case "escape":
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
  }

  function onKeyUp(event) {
    if (currentScreen === "play" && running && !paused) {
      handlePlayKey(event, true);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    handleAction(button.getAttribute("data-action"));
  });

  collectScreens();
  Object.keys(screens).forEach(function (id) {
    setInert(screens[id], id !== "home");
  });
  setPauseOpen(false);
  best = readBest();
  updateBestReadout();
  focusFirst(screens.home);
})();
