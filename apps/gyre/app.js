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
  var SIDES = 6;
  var PLAYER_R = 78;
  var CORE_R = 42;
  var SPAWN_R = 318;
  var BEST_KEY = "gyre-best";
  var AMBER = "#FFB000";
  var CREAM = "#FFF4E0";
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
  var playerAngle = 0;
  var walls = [];
  var nextSpawn = 0;
  var flash = 0;
  var dragX = null;
  var STEP = TAU / 6;

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

  function sector(angle) {
    return Math.floor(wrapAngle(angle) / (TAU / SIDES)) % SIDES;
  }

  function wallSpeed() {
    return 168 + Math.min(140, time * 9);
  }

  function spawnGap() {
    return 0.72 - Math.min(0.28, time * 0.012);
  }

  function spawnWall() {
    walls.push({
      r: SPAWN_R,
      gap: (Math.random() * SIDES) | 0,
      wide: Math.random() < 0.28,
      scored: false,
    });
  }

  function playerSafe(wall) {
    var slot = sector(playerAngle);
    if (slot === wall.gap) return true;
    if (wall.wide && slot === (wall.gap + 1) % SIDES) return true;
    return false;
  }

  function startRun() {
    running = true;
    paused = false;
    time = 0;
    score = 0;
    playerAngle = 0;
    walls = [];
    nextSpawn = 0.55;
    flash = 0;
    lastTs = 0;
    dragX = null;
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    loop();
  }

  function pauseRun() {
    if (!running || paused) return;
    paused = true;
    dragX = null;
    pauseOverlay.classList.remove("hidden");
    focusFirst(pauseOverlay);
  }

  function resumeRun() {
    if (!running || !paused) return;
    paused = false;
    lastTs = 0;
    dragX = null;
    pauseOverlay.classList.add("hidden");
    focusPlay();
  }

  function stopLoop() {
    running = false;
    paused = false;
    dragX = null;
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

  function rotateBy(steps) {
    playerAngle = wrapAngle(playerAngle + steps * STEP);
  }

  function update(dt) {
    time += dt;
    if (flash > 0) flash -= dt;

    nextSpawn -= dt;
    if (nextSpawn <= 0) {
      spawnWall();
      nextSpawn = spawnGap();
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
        }
      }
    });
    walls = walls.filter(function (wall) {
      return wall.r > CORE_R + 6;
    });
    if (dead) {
      flash = 0.2;
      endRun();
    }
  }

  function hexPoint(r, i, outR) {
    var a = -Math.PI / 2 + (TAU * i) / SIDES;
    return { x: CX + Math.cos(a) * (outR || r), y: CY + Math.sin(a) * (outR || r) };
  }

  function drawHex(r, fill, stroke, width) {
    ctx.beginPath();
    var i;
    for (i = 0; i < SIDES; i += 1) {
      var p = hexPoint(r, i);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width || 3;
      ctx.stroke();
    }
  }

  function drawWall(wall) {
    var i;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 14;
    ctx.lineCap = "butt";
    for (i = 0; i < SIDES; i += 1) {
      if (i === wall.gap) continue;
      if (wall.wide && i === (wall.gap + 1) % SIDES) continue;
      var a = hexPoint(wall.r, i);
      var b = hexPoint(wall.r, i + 1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    walls.forEach(drawWall);
    drawHex(CORE_R, SURFACE, AMBER, 3);

    var px = CX + Math.cos(playerAngle) * PLAYER_R;
    var py = CY + Math.sin(playerAngle) * PLAYER_R;
    var tx = -Math.sin(playerAngle);
    var ty = Math.cos(playerAngle);
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(playerAngle) * 16, py + Math.sin(playerAngle) * 16);
    ctx.lineTo(px - tx * 12 - Math.cos(playerAngle) * 8, py - ty * 12 - Math.sin(playerAngle) * 8);
    ctx.lineTo(px + tx * 12 - Math.cos(playerAngle) * 8, py + ty * 12 - Math.sin(playerAngle) * 8);
    ctx.closePath();
    ctx.fillStyle = CREAM;
    ctx.fill();

    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 51, 51, " + flash * 0.4 + ")";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("GATES " + pad(score, 5), 28, 45);
    ctx.fillStyle = RED;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText("TAP L/R", 500, 45);
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

  document.addEventListener("pointerdown", function (event) {
    if (currentScreen !== "play" || !running || paused) return;
    dragX = event.clientX;
  });

  document.addEventListener("pointermove", function (event) {
    if (dragX == null || currentScreen !== "play" || !running || paused) return;
    var dx = event.clientX - dragX;
    if (Math.abs(dx) < 6) return;
    playerAngle = wrapAngle(playerAngle + dx * 0.025);
    dragX = event.clientX;
  });

  document.addEventListener("pointerup", function () {
    dragX = null;
  });

  document.addEventListener("pointercancel", function () {
    dragX = null;
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
