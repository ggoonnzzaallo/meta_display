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
  var time = 0;
  var score = 0;
  var best = 0;
  var sides = MIN_SIDES;
  var playerAngle = 0;
  var walls = [];
  var streaks = [];
  var nextSpawn = 0;
  var flash = 0;
  var banner = "";
  var bannerT = 0;
  var hue = 0;

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

  function hsl(h, s, l, a) {
    return "hsla(" + (h % 360) + ", " + s + "%, " + l + "%, " + (a == null ? 1 : a) + ")";
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
    if (n === sides) return;
    var ang = playerAngle;
    sides = n;
    playerAngle = faceAngle(sector(ang, n), n);
    banner = n + " SIDES";
    bannerT = 1.4;
  }

  function wallSpeed() {
    return 68 + (sides - MIN_SIDES) * 8;
  }

  function spawnInterval() {
    return 1.52 - (sides - MIN_SIDES) * 0.1;
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
      hue: hue,
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

  function resetStreaks() {
    streaks = [];
    var i;
    for (i = 0; i < 52; i += 1) {
      streaks.push({
        a: Math.random() * TAU,
        z: Math.random(),
        len: 0.05 + Math.random() * 0.12,
        spd: 0.28 + Math.random() * 0.5,
        tint: Math.random(),
      });
    }
  }

  function startRun() {
    running = true;
    paused = false;
    time = 0;
    score = 0;
    sides = MIN_SIDES;
    playerAngle = faceAngle(0, sides);
    walls = [];
    nextSpawn = 1.15;
    flash = 0;
    banner = "3 SIDES";
    bannerT = 1.2;
    hue = 200;
    lastTs = 0;
    resetStreaks();
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

  function updateStreaks(dt) {
    var warp = 0.7 + (sides - MIN_SIDES) * 0.12;
    streaks.forEach(function (s) {
      s.z -= s.spd * dt * warp;
      if (s.z <= 0.04) {
        s.z = 1;
        s.a = Math.random() * TAU;
      }
    });
  }

  function update(dt) {
    time += dt;
    hue = wrapAngle(time * 0.55) * (360 / TAU) + score * 8;
    if (flash > 0) flash -= dt;
    if (bannerT > 0) bannerT -= dt;
    updateStreaks(dt);

    nextSpawn -= dt;
    if (nextSpawn <= 0) {
      spawnWall();
      nextSpawn = spawnInterval();
    }

    var speed = wallSpeed();
    var dead = false;
    walls.forEach(function (wall) {
      wall.r -= speed * dt;
      if (!wall.scored && wall.r <= PLAYER_R) {
        if (!playerSafe(wall)) dead = true;
        else {
          wall.scored = true;
          score += 1;
          snapToSides(sidesForScore(score));
        }
      }
    });
    walls = walls.filter(function (wall) {
      return wall.r > CORE_R + 8;
    });
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

  function drawTunnel() {
    var i;
    var depth;
    var r;
    var spin = time * 0.12;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(spin);
    ctx.translate(-CX, -CY);
    for (i = 0; i < 11; i += 1) {
      depth = (i / 11 + time * 0.35) % 1;
      r = CORE_R + 18 + depth * (SPAWN_R - CORE_R);
      drawPoly(r, sides, hsl(hue + i * 28, 100, 58), 2 + (1 - depth) * 5, 0.12 + (1 - depth) * 0.28);
    }
    ctx.restore();
  }

  function drawStreaks() {
    streaks.forEach(function (s) {
      var r0 = CORE_R + s.z * (SPAWN_R - 10);
      var r1 = CORE_R + Math.min(1, s.z + s.len) * (SPAWN_R - 10);
      ctx.strokeStyle = hsl(hue + s.tint * 140, 100, 70, 0.22 + s.z * 0.35);
      ctx.lineWidth = 1.5 + s.z * 2;
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(s.a) * r0, CY + Math.sin(s.a) * r0);
      ctx.lineTo(CX + Math.cos(s.a) * r1, CY + Math.sin(s.a) * r1);
      ctx.stroke();
    });
  }

  function drawWall(wall) {
    var i;
    var ghost;
    var a;
    var b;
    var n = wall.sides;
    var near = 1 - Math.max(0, Math.min(1, (wall.r - PLAYER_R) / (SPAWN_R - PLAYER_R)));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (ghost = 2; ghost >= 0; ghost -= 1) {
      var gr = wall.r + ghost * 16;
      if (gr > SPAWN_R + 8) continue;
      for (i = 0; i < n; i += 1) {
        a = polyPoint(gr, i, n);
        b = polyPoint(gr, i + 1, n);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (isGap(wall, i)) {
          ctx.strokeStyle = "rgba(0, 255, 136, " + (0.18 + near * 0.55) / (ghost + 1) + ")";
          ctx.lineWidth = (8 + near * 8) / (ghost + 1);
          ctx.shadowColor = GREEN;
          ctx.shadowBlur = ghost === 0 ? 14 : 0;
        } else {
          ctx.strokeStyle = hsl(wall.hue + i * 18, 100, 58, (0.35 + near * 0.65) / (ghost + 1));
          ctx.lineWidth = (11 + near * 10) / (ghost + 1);
          ctx.shadowColor = hsl(wall.hue, 100, 60);
          ctx.shadowBlur = ghost === 0 ? 12 : 0;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawPlayer() {
    var px = CX + Math.cos(playerAngle) * PLAYER_R;
    var py = CY + Math.sin(playerAngle) * PLAYER_R;
    var tx = -Math.sin(playerAngle);
    var ty = Math.cos(playerAngle);
    var ca = Math.cos(playerAngle);
    var sa = Math.sin(playerAngle);
    ctx.beginPath();
    ctx.moveTo(px + ca * 18, py + sa * 18);
    ctx.lineTo(px - tx * 13 - ca * 9, py - ty * 13 - sa * 9);
    ctx.lineTo(px + tx * 13 - ca * 9, py + ty * 13 - sa * 9);
    ctx.closePath();
    ctx.fillStyle = CREAM;
    ctx.shadowColor = hsl(hue, 100, 70);
    ctx.shadowBlur = 16;
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
    ctx.fillStyle = hsl(hue, 100, 65);
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.fillText(sides + " SIDES", 220, 47);
    ctx.textAlign = "right";
    ctx.fillStyle = GREEN;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText("TAP L/R", 568, 47);

    if (bannerT > 0) {
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, bannerT * 2);
      ctx.fillStyle = hsl(hue, 100, 70);
      ctx.font = "700 36px ui-monospace, monospace";
      ctx.shadowColor = hsl(hue, 100, 60);
      ctx.shadowBlur = 18;
      ctx.fillText(banner, CX, 120);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawTunnel();
    drawStreaks();
    walls.forEach(drawWall);
    drawPoly(CORE_R, sides, hsl(hue, 100, 62), 3, 0.85);
    ctx.beginPath();
    ctx.arc(CX, CY, 7, 0, TAU);
    ctx.fillStyle = hsl(hue + 180, 100, 60);
    ctx.fill();
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
