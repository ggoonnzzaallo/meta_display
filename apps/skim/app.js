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
  var SHIP_X = 132;
  var SHIP_R = 11;
  var TOP = 64;
  var BOT = 584;
  var CRUISE = 270;
  var BOOST_SPD = 520;
  var BOOST_T = 0.4;
  var BOOST_CD = 1.1;
  var IMPULSE = 125;
  var VY_MAX = 400;
  var DAMP = 2.5;
  var BEST_KEY = "skim-best";
  var ENDLESS_KEY = "skim-endless";
  var CYAN = "#00D4FF";
  var CREAM = "#FFF4E0";
  var GOLD = "#FFB000";
  var RED = "#FF3333";
  var SURFACE = "#1C1E21";
  var MUTED = "#2A2D31";

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function path(length, gap, amp, period, base) {
    var pts = [
      { x: 0, floor: base, gap: gap },
      { x: 460, floor: base, gap: gap },
    ];
    var x;
    for (x = 520; x < length - 320; x += 70) {
      pts.push({
        x: x,
        floor: base + Math.sin(((x - 520) / period) * Math.PI * 2) * amp,
        gap: gap,
      });
    }
    pts.push({ x: length, floor: base, gap: gap });
    return pts;
  }

  function gate(x, holeY, holeH) {
    var topH = Math.max(10, holeY - TOP);
    var botY = holeY + holeH;
    return [
      { x: x, y: TOP, w: 26, h: topH },
      { x: x, y: botY, w: 26, h: Math.max(10, BOT - botY) },
    ];
  }

  var COURSES = [
    {
      name: "RIDGE 1",
      length: 3200,
      pts: path(3200, 268, 42, 520, 468),
      blocks: gate(2300, 268, 150),
    },
    {
      name: "GATES",
      length: 3600,
      pts: path(3600, 250, 28, 640, 470),
      blocks: gate(900, 240, 150)
        .concat(gate(1600, 300, 140))
        .concat(gate(2300, 210, 145))
        .concat(gate(3000, 280, 150)),
    },
    {
      name: "SQUEEZE",
      length: 3400,
      pts: [
        { x: 0, floor: 470, gap: 260 },
        { x: 500, floor: 470, gap: 250 },
        { x: 1100, floor: 490, gap: 170 },
        { x: 1800, floor: 430, gap: 160 },
        { x: 2500, floor: 510, gap: 155 },
        { x: 3400, floor: 470, gap: 220 },
      ],
      blocks: gate(2000, 290, 120),
    },
    {
      name: "STAIRS",
      length: 3600,
      pts: [
        { x: 0, floor: 480, gap: 250 },
        { x: 400, floor: 480, gap: 250 },
        { x: 700, floor: 400, gap: 210 },
        { x: 1100, floor: 530, gap: 210 },
        { x: 1500, floor: 390, gap: 200 },
        { x: 1900, floor: 540, gap: 200 },
        { x: 2400, floor: 410, gap: 190 },
        { x: 2900, floor: 520, gap: 200 },
        { x: 3600, floor: 470, gap: 230 },
      ],
      blocks: [],
    },
    {
      name: "SLALOM",
      length: 3800,
      pts: path(3800, 240, 36, 480, 472),
      blocks: [
        { x: 800, y: 200, w: 36, h: 150 },
        { x: 1200, y: 360, w: 36, h: 180 },
        { x: 1650, y: 180, w: 36, h: 160 },
        { x: 2100, y: 340, w: 36, h: 190 },
        { x: 2550, y: 190, w: 36, h: 150 },
        { x: 3000, y: 350, w: 36, h: 180 },
      ],
    },
    {
      name: "SPIKE",
      length: 4000,
      pts: path(4000, 168, 58, 360, 478),
      blocks: gate(1400, 270, 115)
        .concat(gate(2200, 310, 110))
        .concat(gate(3100, 250, 115)),
    },
  ];

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var playBtn = document.getElementById("play-btn");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");
  var overTitle = document.getElementById("over-title");
  var nextBtn = document.getElementById("next-btn");

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var mode = "campaign";
  var courseIndex = 0;
  var course = COURSES[0];
  var pts = course.pts;
  var blocks = course.blocks;
  var length = course.length;
  var x = 0;
  var y = 330;
  var vy = 0;
  var time = 0;
  var boostT = 0;
  var boostCd = 0;
  var grace = 0;
  var flash = 0;
  var outcome = "";
  var best = 0;
  var endlessBest = 0;
  var seed = 1;
  var campaignTimes = [];
  var lastNudgeDir = 0;
  var lastNudgeAt = 0;
  var lastNudgeChain = 0;

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

  function fmtTime(t) {
    if (!t && t !== 0) return "--.--";
    return (Math.floor(t * 100) / 100).toFixed(2);
  }

  function readNum(key) {
    try {
      return parseFloat(localStorage.getItem(key) || "0") || 0;
    } catch (err) {
      return 0;
    }
  }

  function writeNum(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (err) {}
  }

  function updateBestReadout() {
    if (!bestReadout) return;
    bestReadout.textContent =
      "BEST " + (best ? fmtTime(best) : "--.--") + "   END " + pad(endlessBest, 5);
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

  function sample(at) {
    var i;
    if (at <= pts[0].x) return pts[0];
    if (at >= pts[pts.length - 1].x) return pts[pts.length - 1];
    for (i = 0; i < pts.length - 1; i += 1) {
      if (at <= pts[i + 1].x) {
        var t = (at - pts[i].x) / (pts[i + 1].x - pts[i].x || 1);
        return {
          floor: lerp(pts[i].floor, pts[i + 1].floor, t),
          gap: lerp(pts[i].gap, pts[i + 1].gap, t),
        };
      }
    }
    return pts[pts.length - 1];
  }

  function hitBox(px, py, r, b) {
    var nx = clamp(px, b.x, b.x + b.w);
    var ny = clamp(py, b.y, b.y + b.h);
    var dx = px - nx;
    var dy = py - ny;
    return dx * dx + dy * dy < r * r;
  }

  function rng(n) {
    seed = (seed * 16807) % 2147483647;
    return seed % n;
  }

  function extendEndless() {
    var last = pts[pts.length - 1];
    var start = last.x;
    var kind = rng(4);
    var i;
    var x0;
    var floor;
    var gap;
    var hole;
    if (kind === 0) {
      for (i = 1; i <= 8; i += 1) {
        x0 = start + i * 80;
        floor = 470 + Math.sin((x0 / 340) * Math.PI * 2) * (40 + rng(20));
        gap = Math.max(140, 230 - Math.floor(start / 1800) * 12);
        pts.push({ x: x0, floor: floor, gap: gap });
      }
    } else if (kind === 1) {
      gap = Math.max(145, 200 - Math.floor(start / 2000) * 10);
      pts.push({ x: start + 200, floor: last.floor - 50, gap: gap });
      pts.push({ x: start + 480, floor: last.floor + 60, gap: gap });
      pts.push({ x: start + 720, floor: 470, gap: gap + 20 });
    } else if (kind === 2) {
      pts.push({ x: start + 640, floor: 472, gap: 210 });
      hole = 200 + rng(140);
      blocks = blocks.concat(gate(start + 320, hole, 118 + rng(20)));
    } else {
      pts.push({ x: start + 700, floor: 470, gap: 200 });
      blocks = blocks.concat([
        { x: start + 240, y: 180 + rng(40), w: 32, h: 140 },
        { x: start + 480, y: 340 + rng(40), w: 32, h: 160 },
      ]);
    }
    length = pts[pts.length - 1].x;
  }

  function loadCourse(index) {
    course = COURSES[index];
    pts = course.pts.slice();
    blocks = course.blocks.slice();
    length = course.length;
  }

  function startRun(nextMode, index) {
    mode = nextMode || mode;
    if (mode === "campaign") {
      courseIndex = index == null ? courseIndex : index;
      loadCourse(courseIndex);
      if (index === 0) campaignTimes = [];
    } else {
      courseIndex = 0;
      seed = 17;
      pts = path(900, 250, 20, 500, 470);
      blocks = [];
      length = 900;
      extendEndless();
      extendEndless();
    }
    running = true;
    paused = false;
    x = 80;
    y = 330;
    vy = 0;
    time = 0;
    boostT = 0;
    boostCd = 0;
    grace = 0.85;
    flash = 0;
    outcome = "";
    lastTs = 0;
    lastNudgeDir = 0;
    lastNudgeAt = 0;
    lastNudgeChain = 0;
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

  function endRun(kind) {
    if (!running) return;
    outcome = kind;
    stopLoop();
    var dist = Math.max(0, Math.floor(x));
    if (mode === "endless" && dist > endlessBest) {
      endlessBest = dist;
      writeNum(ENDLESS_KEY, endlessBest);
      updateBestReadout();
    }
    if (kind === "clear") campaignTimes[courseIndex] = time;
    var total = 0;
    campaignTimes.forEach(function (t) {
      total += t;
    });
    if (kind === "done" && total && (!best || total < best)) {
      best = total;
      writeNum(BEST_KEY, best);
      updateBestReadout();
    }
    var hasNext = kind === "clear" && courseIndex < COURSES.length - 1;
    if (nextBtn) {
      if (hasNext) nextBtn.classList.remove("hidden");
      else nextBtn.classList.add("hidden");
    }
    if (overTitle) {
      overTitle.textContent =
        kind === "done" ? "CLEAR" : kind === "clear" ? "GATE" : "CRASHED";
    }
    if (overStats) {
      if (mode === "endless") {
        overStats.innerHTML = "DIST " + pad(dist, 5) + "<br>BEST " + pad(endlessBest, 5);
      } else if (kind === "done") {
        overStats.innerHTML = "TOTAL " + fmtTime(total) + "<br>BEST " + fmtTime(best || total);
      } else if (kind === "clear") {
        overStats.innerHTML =
          COURSES[courseIndex].name + "  " + fmtTime(time) + "<br>" + (courseIndex + 1) + " / 6";
      } else {
        overStats.innerHTML =
          (mode === "campaign" ? COURSES[courseIndex].name : "ENDLESS") +
          "<br>" +
          fmtTime(time);
      }
    }
    navigateTo("over");
  }

  function nudge(dir) {
    var now = performance.now();
    var chain = 1;
    if (dir === lastNudgeDir && now - lastNudgeAt < 300) {
      chain = lastNudgeChain + 1;
    }
    lastNudgeDir = dir;
    lastNudgeAt = now;
    lastNudgeChain = chain;
    var force = IMPULSE * (chain === 1 ? 1 : chain === 2 ? 1.6 : 2.15);
    vy = clamp(vy + dir * force, -VY_MAX, VY_MAX);
  }

  function tryBoost() {
    if (!running || paused) return;
    if (boostCd > 0 || boostT > 0) return;
    boostT = BOOST_T;
    boostCd = BOOST_CD;
  }

  function colliding() {
    var worldX = x + SHIP_X;
    var s = sample(worldX);
    var ceil = s.floor - s.gap;
    if (y + SHIP_R > s.floor || y - SHIP_R < ceil) return true;
    var i;
    for (i = 0; i < blocks.length; i += 1) {
      if (hitBox(worldX, y, SHIP_R, blocks[i])) return true;
    }
    return false;
  }

  function update(dt) {
    time += dt;
    if (flash > 0) flash -= dt;
    if (grace > 0) grace -= dt;
    if (boostT > 0) boostT -= dt;
    if (boostCd > 0) boostCd -= dt;
    vy *= Math.exp(-DAMP * dt);
    y = clamp(y + vy * dt, TOP + 8, BOT - 8);
    var spd = boostT > 0 ? BOOST_SPD : CRUISE;
    if (mode === "endless") spd += Math.min(180, x / 40);
    x += spd * dt;
    if (mode === "endless" && x + 900 > length) extendEndless();
    if (grace <= 0 && colliding()) {
      flash = 0.2;
      endRun("crash");
      return;
    }
    if (mode === "campaign" && x + SHIP_X >= length) {
      if (courseIndex >= COURSES.length - 1) endRun("done");
      else endRun("clear");
    }
  }

  function drawTerrain() {
    var cam = x;
    var sx;
    var s;
    var wx;
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    for (sx = 0; sx <= SIZE; sx += 8) {
      wx = cam + sx;
      s = sample(wx);
      ctx.lineTo(sx, s.floor);
    }
    ctx.lineTo(SIZE, SIZE);
    ctx.closePath();
    ctx.fillStyle = SURFACE;
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (sx = 0; sx <= SIZE; sx += 8) {
      wx = cam + sx;
      s = sample(wx);
      ctx.lineTo(sx, s.floor - s.gap);
    }
    ctx.lineTo(SIZE, 0);
    ctx.closePath();
    ctx.fillStyle = SURFACE;
    ctx.fill();
    ctx.stroke();
  }

  function drawBlocks() {
    var cam = x;
    ctx.fillStyle = MUTED;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    blocks.forEach(function (b) {
      var sx = b.x - cam;
      if (sx + b.w < -8 || sx > SIZE + 8) return;
      ctx.fillRect(sx, b.y, b.w, b.h);
      ctx.strokeRect(sx, b.y, b.w, b.h);
    });
  }

  function drawFinish() {
    if (mode !== "campaign") return;
    var sx = length - x;
    if (sx < -20 || sx > SIZE + 20) return;
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(sx, TOP);
    ctx.lineTo(sx, BOT);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawShip() {
    ctx.save();
    ctx.translate(SHIP_X, y);
    ctx.rotate(clamp(vy / 520, -0.55, 0.55));
    if (boostT > 0) {
      ctx.fillStyle = CYAN;
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(-34, -7);
      ctx.lineTo(-28, 0);
      ctx.lineTo(-34, 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-12, -9);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-12, 9);
    ctx.closePath();
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.restore();
  }

  function drawHud() {
    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 12, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.textAlign = "left";
    var label =
      mode === "endless"
        ? "ENDLESS  " + pad(Math.floor(x), 5)
        : COURSES[courseIndex].name + "  " + fmtTime(time);
    ctx.fillText(label, 28, 41);
    ctx.textAlign = "right";
    ctx.fillStyle = boostCd <= 0 && boostT <= 0 ? CYAN : MUTED;
    ctx.fillText(boostT > 0 ? "BOOST" : "PINCH", 572, 41);
    ctx.textAlign = "left";
  }

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawTerrain();
    drawBlocks();
    drawFinish();
    drawShip();
    if (flash > 0) {
      ctx.fillStyle = "rgba(255, 51, 51, " + flash * 0.45 + ")";
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    drawHud();
    ctx.fillStyle = RED;
    ctx.font = "700 13px ui-monospace, monospace";
    ctx.fillText("U/D  PINCH BOOST", 28, 586);
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
      tryBoost();
      focusPlay();
      return;
    }
    if (key === "up" || key === "left") nudge(-1);
    else if (key === "down" || key === "right") nudge(1);
    if (event.repeat) return;
    focusPlay();
  }

  function handleAction(action) {
    if (action === "play") startRun("campaign", 0);
    else if (action === "endless") startRun("endless", 0);
    else if (action === "again") {
      if (mode === "endless") startRun("endless", 0);
      else startRun("campaign", courseIndex);
    } else if (action === "next") startRun("campaign", courseIndex + 1);
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopLoop();
      navigateTo("home");
    } else if (action === "resume") resumeRun();
    else if (action === "boost") tryBoost();
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
  best = readNum(BEST_KEY);
  endlessBest = Math.floor(readNum(ENDLESS_KEY));
  updateBestReadout();
  focusFirst(screens.home);
})();
