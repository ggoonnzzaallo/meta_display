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
  var AIM_X = 300;
  var AIM_Y = 300;
  var BEST_KEY = "strike-best";
  var MAX_AMMO = 3;
  var RELOAD_S = 1.2;
  var MAX_PARTICLES = 24;
  var MAX_TRAIL = 8;

  var AMBER = "#FFB000";
  var ORANGE = "#FF6B35";
  var RED = "#FF3333";
  var CYAN = "#00D4FF";
  var GOLD = "#FFD23F";
  var CREAM = "#FFF4E0";
  var BODY = "#3A3D42";

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var fireBtn = document.getElementById("fire-btn");
  var pauseOverlay = document.getElementById("pause-overlay");
  var bestReadout = document.getElementById("best-readout");

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;

  var score = 0;
  var best = 0;
  var killFlash = 0;
  var ammo = MAX_AMMO;
  var reloadT = 0;
  var missiles = [];
  var particles = [];
  var audioCtx = null;
  var fireLockAt = 0;

  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = "0" + s;
    return s;
  }

  function hypot(ax, ay) {
    return Math.sqrt(ax * ax + ay * ay);
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

  function focusFire() {
    if (fireBtn) fireBtn.focus();
  }

  function navigateTo(screenId) {
    Object.keys(screens).forEach(function (id) {
      screens[id].classList.add("hidden");
    });
    if (!screens[screenId]) return;
    screens[screenId].classList.remove("hidden");
    currentScreen = screenId;
    if (screenId === "play") focusFire();
    else focusFirst(screens[screenId]);
  }

  function focusRoot() {
    if (currentScreen === "play" && paused) return pauseOverlay;
    return screens[currentScreen];
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

  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function muteAudio() {
    if (audioCtx && audioCtx.state === "running") {
      audioCtx.suspend();
    }
  }

  function tone(freq, dur, type, vol, slide) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, ctx.currentTime + dur);
    gain.gain.setValueAtTime(vol || 0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  function noiseBurst(dur, vol, cutoff) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var i;
    for (i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff || 900, ctx.currentTime);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  function playSfx(name) {
    switch (name) {
      case "launch":
        tone(180, 0.22, "sawtooth", 0.09, 70);
        noiseBurst(0.16, 0.08, 1400);
        break;
      case "boom":
        tone(90, 0.28, "triangle", 0.16, 40);
        noiseBurst(0.32, 0.2, 700);
        break;
      case "empty":
        tone(140, 0.06, "square", 0.05);
        break;
      case "reload":
        tone(220, 0.08, "square", 0.07);
        setTimeout(function () {
          tone(320, 0.1, "square", 0.07);
        }, 90);
        break;
      default:
        break;
    }
  }

  function burst(x, y, colors, count, big) {
    var i;
    for (i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 50 + Math.random() * (big ? 240 : 130);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.22 + Math.random() * 0.2,
        age: 0,
        r: (big ? 7 : 4) + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
        kind: Math.random() > 0.45 ? "star" : "ring",
      });
    }
  }

  function explodeHit(x, y) {
    burst(x, y, [GOLD, ORANGE, CREAM, RED], 14, true);
    playSfx("boom");
    killFlash = 0.4;
    score += 1;
    if (score > best) {
      best = score;
      writeBest(best);
    }
  }

  function spawnMissile() {
    missiles.push({
      x: AIM_X,
      y: 548,
      vx: 0,
      vy: -520,
      life: 0.7,
      trail: [],
    });
  }

  function tryFire() {
    if (!running || paused) return;
    var now = performance.now();
    if (now - fireLockAt < 90) return;
    fireLockAt = now;
    ensureAudio();
    if (reloadT > 0) {
      playSfx("empty");
      return;
    }
    if (ammo <= 0) {
      reloadT = RELOAD_S;
      playSfx("reload");
      return;
    }
    ammo -= 1;
    spawnMissile();
    playSfx("launch");
  }

  function updateMissiles(dt) {
    var next = [];
    var i;
    for (i = 0; i < missiles.length; i++) {
      var m = missiles[i];
      m.life -= dt;
      var dx = AIM_X - m.x;
      var dy = AIM_Y - m.y;
      var d = hypot(dx, dy) || 1;
      var speed = 560;
      m.vx = (dx / d) * speed;
      m.vy = (dy / d) * speed;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > MAX_TRAIL) m.trail.shift();
      if (d < 22) {
        explodeHit(AIM_X, AIM_Y);
        continue;
      }
      if (m.life > 0) next.push(m);
      else explodeHit(m.x, m.y);
    }
    missiles = next;
  }

  function updateParticles(dt) {
    var next = [];
    var i;
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      next.push(p);
    }
    particles = next;
  }

  function updateSim(dt) {
    killFlash = Math.max(0, killFlash - dt);
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloadT = 0;
        ammo = MAX_AMMO;
      }
    }
    updateMissiles(dt);
    updateParticles(dt);
  }

  function drawCorners(c) {
    var m = 18;
    var len = 22;
    c.beginPath();
    c.moveTo(m, m + len);
    c.lineTo(m, m);
    c.lineTo(m + len, m);
    c.moveTo(SIZE - m - len, m);
    c.lineTo(SIZE - m, m);
    c.lineTo(SIZE - m, m + len);
    c.moveTo(SIZE - m, SIZE - m - len);
    c.lineTo(SIZE - m, SIZE - m);
    c.lineTo(SIZE - m - len, SIZE - m);
    c.moveTo(m + len, SIZE - m);
    c.lineTo(m, SIZE - m);
    c.lineTo(m, SIZE - m - len);
    c.stroke();
  }

  function drawLockBox(c, x, y, half) {
    var corner = 14;
    c.beginPath();
    c.moveTo(x - half, y - half + corner);
    c.lineTo(x - half, y - half);
    c.lineTo(x - half + corner, y - half);
    c.moveTo(x + half - corner, y - half);
    c.lineTo(x + half, y - half);
    c.lineTo(x + half, y - half + corner);
    c.moveTo(x + half, y + half - corner);
    c.lineTo(x + half, y + half);
    c.lineTo(x + half, y + half - corner);
    c.moveTo(x - half + corner, y + half);
    c.lineTo(x - half, y + half);
    c.lineTo(x - half, y + half - corner);
    c.stroke();
  }

  function drawPipper(c) {
    var x = AIM_X;
    var y = AIM_Y;
    c.strokeStyle = killFlash > 0 ? RED : CYAN;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, 16, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(x - 26, y);
    c.lineTo(x - 8, y);
    c.moveTo(x + 8, y);
    c.lineTo(x + 26, y);
    c.moveTo(x, y - 26);
    c.lineTo(x, y - 8);
    c.moveTo(x, y + 8);
    c.lineTo(x, y + 26);
    c.stroke();
    c.fillStyle = killFlash > 0 ? RED : CYAN;
    c.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  function drawMissileIcon(c, x, y, live, scale) {
    var s = scale || 1;
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    c.fillStyle = live ? ORANGE : BODY;
    c.beginPath();
    c.moveTo(0, -14);
    c.lineTo(6, -2);
    c.lineTo(6, 10);
    c.lineTo(-6, 10);
    c.lineTo(-6, -2);
    c.closePath();
    c.fill();
    c.fillStyle = live ? GOLD : "#2A2D31";
    c.beginPath();
    c.moveTo(0, -14);
    c.lineTo(6, -2);
    c.lineTo(-6, -2);
    c.closePath();
    c.fill();
    c.fillStyle = live ? CYAN : "#2A2D31";
    c.beginPath();
    c.moveTo(-6, 4);
    c.lineTo(-11, 12);
    c.lineTo(-6, 10);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(6, 4);
    c.lineTo(11, 12);
    c.lineTo(6, 10);
    c.closePath();
    c.fill();
    if (live) {
      c.fillStyle = AMBER;
      c.beginPath();
      c.moveTo(-3, 10);
      c.lineTo(0, 16);
      c.lineTo(3, 10);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  function drawMissile(c, m) {
    var i;
    for (i = 0; i < m.trail.length; i++) {
      var t = m.trail[i];
      var a = (i + 1) / m.trail.length;
      c.fillStyle = "rgba(255, 178, 80," + (0.18 * a).toFixed(3) + ")";
      c.beginPath();
      c.arc(t.x, t.y, 5 + a * 4, 0, Math.PI * 2);
      c.fill();
    }
    var ang = Math.atan2(m.vy, m.vx) + Math.PI / 2;
    c.save();
    c.translate(m.x, m.y);
    c.rotate(ang);
    drawMissileIcon(c, 0, 0, true, 1.15);
    c.restore();
  }

  function drawStar(c, x, y, r) {
    var i;
    c.beginPath();
    for (i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4 - Math.PI / 2;
      var rad = i % 2 === 0 ? r : r * 0.45;
      var px = x + Math.cos(a) * rad;
      var py = y + Math.sin(a) * rad;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
  }

  function drawParticles(c) {
    var i;
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      var fade = 1 - p.age / p.life;
      c.globalAlpha = fade;
      c.fillStyle = p.color;
      c.strokeStyle = p.color;
      c.lineWidth = 2;
      if (p.kind === "ring") {
        c.beginPath();
        c.arc(p.x, p.y, p.r * (0.6 + (1 - fade) * 0.8), 0, Math.PI * 2);
        c.stroke();
      } else {
        drawStar(c, p.x, p.y, p.r * fade);
      }
    }
    c.globalAlpha = 1;
  }

  function drawAmmo(c) {
    var i;
    var pulse = reloadT > 0 ? 0.55 + Math.sin(performance.now() / 90) * 0.45 : 1;
    for (i = 0; i < MAX_AMMO; i++) {
      var live = reloadT > 0 ? pulse > 0.7 : i < ammo;
      c.globalAlpha = reloadT > 0 ? pulse : 1;
      drawMissileIcon(c, 300 + (i - 1) * 36, 568, live, 0.85);
    }
    c.globalAlpha = 1;
  }

  function drawHud() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var dpr = canvas.width / SIZE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 2;
    drawCorners(ctx);

    ctx.font = "bold 18px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    ctx.fillStyle = ORANGE;
    ctx.textAlign = "left";
    ctx.fillText("STRIKE", 24, 36);
    ctx.textAlign = "right";
    ctx.fillText(pad(score, 5), 576, 36);

    var status = "LOCK";
    var statusColor = RED;
    if (reloadT > 0) {
      status = "RELOAD";
      statusColor = CYAN;
    } else if (ammo <= 0) {
      status = "EMPTY";
      statusColor = AMBER;
    } else if (killFlash > 0) {
      status = "FOX";
      statusColor = RED;
    }
    ctx.fillStyle = statusColor;
    ctx.textAlign = "center";
    ctx.font = "bold 22px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    ctx.fillText(status, 300, 64);

    ctx.strokeStyle = killFlash > 0 ? RED : ORANGE;
    ctx.lineWidth = 2;
    drawLockBox(ctx, AIM_X, AIM_Y, 48);

    var i;
    for (i = 0; i < missiles.length; i++) drawMissile(ctx, missiles[i]);
    drawParticles(ctx);
    drawPipper(ctx);
    drawAmmo(ctx);
  }

  function tick(now) {
    if (!running) return;
    if (!lastTs) lastTs = now;
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;
    if (!paused) updateSim(dt);
    drawHud();
    if (running) rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (running) return;
    lastTs = 0;
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function startHunt() {
    ensureAudio();
    score = 0;
    killFlash = 0;
    ammo = MAX_AMMO;
    reloadT = 0;
    missiles = [];
    particles = [];
    paused = false;
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    startLoop();
  }

  function pauseGame() {
    if (!running || paused) return;
    paused = true;
    muteAudio();
    pauseOverlay.classList.remove("hidden");
    focusFirst(pauseOverlay);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    ensureAudio();
    pauseOverlay.classList.add("hidden");
    lastTs = 0;
    focusFire();
  }

  function quitToTitle() {
    stopLoop();
    muteAudio();
    paused = false;
    pauseOverlay.classList.add("hidden");
    updateBestReadout();
    navigateTo("home");
  }

  function handleAction(action) {
    switch (action) {
      case "home":
        quitToTitle();
        break;
      case "how":
        navigateTo("how");
        break;
      case "play":
        startHunt();
        break;
      case "fire":
        tryFire();
        break;
      case "resume":
        resumeGame();
        break;
      case "quit":
        quitToTitle();
        break;
      default:
        break;
    }
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "play" && !paused) {
      if (event.key === DPAD.SELECT) {
        event.preventDefault();
        tryFire();
        return;
      }
      if (event.key === DPAD.BACK) {
        event.preventDefault();
        pauseGame();
        return;
      }
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
      default:
        return;
    }
    event.preventDefault();
  });

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;
    handleAction(target.getAttribute("data-action"));
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && currentScreen === "play" && running && !paused) {
      pauseGame();
    }
  });

  function fitCanvas() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
  }

  best = readBest();
  updateBestReadout();
  collectScreens();
  fitCanvas();
  navigateTo("home");
})();
