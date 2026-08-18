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
  var TAU = Math.PI * 2;
  var MIN_SIDES = 3;
  var MAX_SIDES = 7;
  var PLAYER_R = 78;
  var CORE_R = 40;
  var SPAWN_R = 330;
  var BEST_KEY = "gyre-best";
  var SHAPE_CLEAR_WAIT = 1.15;
  var CREAM = "#FFF4E0";
  var GREEN = "#00FF88";
  var RED = "#FF3333";
  var SURFACE = "#1C1E21";

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
  var score = 0;
  var best = 0;
  var sides = MIN_SIDES;
  var playerAngle = 0;
  var walls = [];
  var nextSpawn = 0;
  var flash = 0;
  var banner = "";
  var bannerT = 0;
  var clearT = 0;
  var audioCtx = null;

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

  function wrapAngle(a) {
    a = a % TAU;
    if (a < 0) a += TAU;
    return a;
  }

  function sidesForScore(s) {
    if (s < 8) return 3;
    if (s < 18) return 4;
    if (s < 30) return 5;
    if (s < 44) return 6;
    return MAX_SIDES;
  }

  function faceAngle(slot, n) {
    n = n || sides;
    return -Math.PI / 2 + ((slot + 0.5) * TAU) / n;
  }

  function sector(angle, n) {
    n = n || sides;
    var a = wrapAngle(angle + Math.PI / 2);
    return Math.floor(a / (TAU / n) + 0.0001) % n;
  }

  function snapToSides(n) {
    if (n === sides) return false;
    var ang = playerAngle;
    sides = n;
    playerAngle = faceAngle(sector(ang, n), n);
    banner = n + " SIDES";
    bannerT = 1.4;
    return true;
  }

  function wallSpeed() {
    return 68 + (sides - MIN_SIDES) * 8;
  }

  function spawnInterval() {
    return 1.52 - (sides - MIN_SIDES) * 0.1;
  }

  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, dur, type, vol, slideTo) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(Math.max(40, freq), t);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function playClearSfx(reshaped) {
    beep(560, 0.09, "triangle", 0.11, 720);
    beep(840, 0.12, "sine", 0.06);
    if (reshaped) {
      beep(392, 0.22, "sine", 0.1);
      beep(588, 0.2, "triangle", 0.07);
    }
  }

  function polyPoint(r, i, n) {
    var a = -Math.PI / 2 + (TAU * i) / n;
    return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
  }

  function spawnWall() {
    walls.push({
      r: SPAWN_R,
      sides: sides,
      gap: (Math.random() * sides) | 0,
      wide: sides >= 5 && Math.random() < 0.22,
      scored: false,
    });
  }

  function isGap(wall, i) {
    if (i === wall.gap) return true;
    if (wall.wide && i === (wall.gap + 1) % wall.sides) return true;
    return false;
  }

  function playerSafe(wall) {
    var slot = sector(playerAngle, wall.sides);
    if (slot === wall.gap) return true;
    if (wall.wide && slot === (wall.gap + 1) % wall.sides) return true;
    return false;
  }

  function startRun() {
    ensureAudio();
    running = true;
    paused = false;
    score = 0;
    sides = MIN_SIDES;
    playerAngle = faceAngle(0, sides);
    walls = [];
    nextSpawn = 1.15;
    flash = 0;
    banner = "3 SIDES";
    bannerT = 1.2;
    clearT = 0;
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
        "GATES " + pad(score, 5) + "<br>SIDES " + sides + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function rotateBy(steps) {
    var slot = (sector(playerAngle, sides) + steps + sides) % sides;
    playerAngle = faceAngle(slot, sides);
  }

  function update(dt) {
    if (flash > 0) flash -= dt;
    if (bannerT > 0) bannerT -= dt;
    if (clearT > 0) clearT -= dt;

    nextSpawn -= dt;
    if (nextSpawn <= 0) {
      spawnWall();
      nextSpawn = spawnInterval();
    }

    var speed = wallSpeed();
    var dead = false;
    var reshaped = false;
    walls.forEach(function (wall) {
      if (reshaped) return;
      wall.r -= speed * dt;
      if (!wall.scored && wall.r <= PLAYER_R) {
        if (!playerSafe(wall)) dead = true;
        else {
          wall.scored = true;
          score += 1;
          reshaped = snapToSides(sidesForScore(score));
          clearT = reshaped ? 0.5 : 0.32;
          playClearSfx(reshaped);
        }
      }
    });
    if (reshaped) {
      walls = [];
      nextSpawn = SHAPE_CLEAR_WAIT;
      dead = false;
    } else {
      walls = walls.filter(function (wall) {
        return wall.r > CORE_R + 8;
      });
    }
    if (dead) {
      flash = 0.22;
      endRun();
    }
  }

  function drawPoly(r, n, stroke, width, alpha) {
    var i;
    var p;
    ctx.beginPath();
    for (i = 0; i < n; i += 1) {
      p = polyPoint(r, i, n);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width || 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawWall(wall) {
    var i;
    var a;
    var b;
    var n = wall.sides;
    var passed = wall.scored || wall.r < PLAYER_R;
    var width = passed ? 4 : 5;
    var color = passed ? GREEN : RED;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.shadowBlur = 0;
    ctx.globalAlpha = passed ? 0.55 : 1;

    for (i = 0; i < n; i += 1) {
      if (!passed && isGap(wall, i)) continue;
      a = polyPoint(wall.r, i, n);
      b = polyPoint(wall.r, i + 1, n);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = passed ? 12 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (!passed) {
      for (i = 0; i < n; i += 1) {
        if (!isGap(wall, i)) continue;
        a = polyPoint(wall.r, i, n);
        b = polyPoint(wall.r, i + 1, n);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = width + 1;
        ctx.shadowColor = GREEN;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayerLane() {
    var i;
    var a;
    var b;
    var slot = sector(playerAngle, sides);
    var inner0 = polyPoint(CORE_R + 6, slot, sides);
    var inner1 = polyPoint(CORE_R + 6, slot + 1, sides);
    var outer0 = polyPoint(PLAYER_R, slot, sides);
    var outer1 = polyPoint(PLAYER_R, slot + 1, sides);
    ctx.lineCap = "butt";
    for (i = 0; i < sides; i += 1) {
      a = polyPoint(PLAYER_R, i, sides);
      b = polyPoint(PLAYER_R, i + 1, sides);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = CREAM;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.moveTo(inner0.x, inner0.y);
    ctx.lineTo(inner1.x, inner1.y);
    ctx.lineTo(outer1.x, outer1.y);
    ctx.lineTo(outer0.x, outer0.y);
    ctx.closePath();
    ctx.fillStyle =
      clearT > 0 ? "rgba(0, 255, 136, " + Math.min(0.55, clearT * 1.8) + ")" : "rgba(255, 244, 224, 0.32)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(outer0.x, outer0.y);
    ctx.lineTo(outer1.x, outer1.y);
    ctx.strokeStyle = clearT > 0 ? GREEN : CREAM;
    ctx.lineWidth = clearT > 0 ? 8 : 5;
    ctx.shadowColor = clearT > 0 ? GREEN : CREAM;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawPlayer() {
    var px = CX + Math.cos(playerAngle) * PLAYER_R;
    var py = CY + Math.sin(playerAngle) * PLAYER_R;
    var tx = -Math.sin(playerAngle);
    var ty = Math.cos(playerAngle);
    var ca = Math.cos(playerAngle);
    var sa = Math.sin(playerAngle);
    ctx.beginPath();
    ctx.moveTo(px + ca * 4, py + sa * 4);
    ctx.lineTo(px - tx * 11 - ca * 14, py - ty * 11 - sa * 14);
    ctx.lineTo(px + tx * 11 - ca * 14, py + ty * 11 - sa * 14);
    ctx.closePath();
    ctx.fillStyle = clearT > 0 ? GREEN : CREAM;
    ctx.shadowColor = clearT > 0 ? GREEN : CREAM;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawHud() {
    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 48);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("GATES " + pad(score, 5), 28, 47);
    ctx.fillStyle = clearT > 0 ? GREEN : CREAM;
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.fillText(sides + " SIDES", 220, 47);
    ctx.textAlign = "right";
    ctx.fillStyle = GREEN;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText(clearT > 0 ? "CLEAR — ROTATE" : "GREEN GAP", 568, 47);

    if (bannerT > 0) {
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, bannerT * 2);
      ctx.fillStyle = CREAM;
      ctx.font = "700 36px ui-monospace, monospace";
      ctx.fillText(banner, CX, 120);
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    walls.forEach(drawWall);
    drawPoly(CORE_R, sides, CREAM, 3, 0.7);
    drawPlayerLane();
    if (clearT > 0) {
      var pulse = Math.min(1, clearT * 3.2);
      drawPoly(PLAYER_R, sides, GREEN, 9, pulse);
      drawPoly(PLAYER_R + (0.32 - Math.min(0.32, clearT)) * 90, sides, GREEN, 3, pulse * 0.45);
    }
    drawPlayer();

    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 51, 51, " + flash * 0.4 + ")";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    drawHud();
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
    if (key === "left" || key === "up") rotateBy(-1);
    if (key === "right" || key === "down") rotateBy(1);
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
