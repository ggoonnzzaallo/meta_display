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
  var MIN_X = 48;
  var MAX_X = 552;
  var LAYER_H = 30;
  var BASE_W = 280;
  var MIN_W = 14;
  var BEST_KEY = "stack-best";
  var GREEN = "#00FF88";
  var CYAN = "#00D4FF";
  var CREAM = "#FFFFFF";
  var SURFACE = "#1C1E21";
  var MUTED = "#2A2D31";

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var score = 0;
  var best = 0;
  var layers = [];
  var bar = { x: 48, w: BASE_W, dir: 1 };
  var speed = 210;
  var dropLock = false;

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
    if (screenId !== "play") focusFirst(screens[screenId]);
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

  function startRun() {
    running = true;
    paused = false;
    score = 0;
    layers = [{ x: (SIZE - BASE_W) / 2, w: BASE_W }];
    bar = { x: MIN_X, w: BASE_W, dir: 1 };
    speed = 210;
    dropLock = false;
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
      overStats.innerHTML = "FLOORS " + pad(score, 5) + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function drop() {
    if (!running || paused || dropLock) return;
    dropLock = true;
    var top = layers[layers.length - 1];
    var left = Math.max(bar.x, top.x);
    var right = Math.min(bar.x + bar.w, top.x + top.w);
    var overlap = right - left;
    if (overlap < MIN_W) {
      endRun();
      return;
    }
    layers.push({ x: left, w: overlap });
    score += 1;
    bar.w = overlap;
    bar.x = bar.dir > 0 ? MIN_X : MAX_X - bar.w;
    speed = Math.min(420, 210 + score * 8);
    dropLock = false;
  }

  function update(dt) {
    bar.x += bar.dir * speed * dt;
    if (bar.x <= MIN_X) {
      bar.x = MIN_X;
      bar.dir = 1;
    } else if (bar.x + bar.w >= MAX_X) {
      bar.x = MAX_X - bar.w;
      bar.dir = -1;
    }
  }

  function layerY(index) {
    return 400 + (layers.length - 1 - index) * LAYER_H;
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    layers.forEach(function (layer, i) {
      var y = layerY(i);
      if (y > 560 || y < 72) return;
      ctx.fillStyle = i === layers.length - 1 ? GREEN : i > layers.length - 6 ? "#12A35A" : MUTED;
      ctx.fillRect(layer.x, y, layer.w, LAYER_H - 3);
    });

    ctx.fillStyle = CYAN;
    ctx.fillRect(bar.x, 400 - LAYER_H, bar.w, LAYER_H - 3);

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("FLOORS " + pad(score, 5), 28, 45);
    ctx.textAlign = "right";
    ctx.fillStyle = CYAN;
    ctx.fillText("PINCH", 572, 45);
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
    if (event.key === DPAD.BACK) {
      pauseRun();
      return;
    }
    if (event.key === DPAD.SELECT && !event.repeat) drop();
  }

  function handleAction(action) {
    if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopLoop();
      navigateTo("home");
    } else if (action === "resume") resumeRun();
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
