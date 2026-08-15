(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var SIZE = 600;
  var AIM_PAD = 24;
  var TARGET_PAD_X = 48;
  var TARGET_TOP = 108;
  var TARGET_BOTTOM = 72;
  var SENSITIVITY = 10;
  var DEADZONE = 2;
  var AIM_LERP = 0.28;
  var LOCK_FILL = 2.5;
  var LOCK_DECAY = 0.4;
  var LOST_CONTACT = 5;
  var SPAWN_GRACE = 1.2;
  var BASE_RADIUS = 52;
  var DEMO_SPEED = 280;
  var BEST_KEY = "lockon-best";
  var MUTE_KEY = "lockon-mute";

  var GREEN = "#00FF88";
  var AMBER = "#FFB000";
  var RED = "#FF3333";
  var CYAN = "#00D4FF";

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var muteBtn = document.getElementById("mute-btn");
  var bestReadout = document.getElementById("best-readout");
  var calibrateCopy = document.getElementById("calibrate-copy");
  var overStats = document.getElementById("over-stats");

  var keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
  };

  var muted = false;
  var demoMode = true;
  var gotOrientation = false;
  var orientationListening = false;
  var rawBeta = 0;
  var rawGamma = 0;
  var beta0 = 0;
  var gamma0 = 0;

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;

  var rng = Math.random;
  var wave = 1;
  var score = 0;
  var best = 0;
  var lockMeter = 0;
  var unlockedTime = 0;
  var grace = 0;
  var locked = false;
  var killFlash = 0;
  var bandit = null;
  var aimX = 300;
  var aimY = 300;
  var targetAimX = 300;
  var targetAimY = 300;
  var demoX = 300;
  var demoY = 300;

  var audioCtx = null;
  var masterGain = null;
  var bed = null;
  var lockTone = null;

  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = "0" + s;
    return s;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function deadzone(v, dz) {
    if (Math.abs(v) < dz) return 0;
    return v > 0 ? v - dz : v + dz;
  }

  function hypot(ax, ay) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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

  function readMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch (err) {
      return false;
    }
  }

  function writeMuted(value) {
    try {
      localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch (err) {}
  }

  function updateBestReadout() {
    if (bestReadout) bestReadout.textContent = "BEST " + pad(best, 5);
  }

  function updateMuteButton() {
    if (muteBtn) muteBtn.textContent = muted ? "UNMUTE" : "MUTE";
  }

  function applyMasterMute() {
    if (!masterGain || !audioCtx) return;
    masterGain.gain.setTargetAtTime(muted ? 0 : 1, audioCtx.currentTime, 0.04);
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
    if (screenId !== "play") focusFirst(screens[screenId]);
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
    if (!audioCtx) {
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    applyMasterMute();
    return audioCtx;
  }

  function startBed() {
    if (!audioCtx || bed) return;
    var g = audioCtx.createGain();
    g.gain.value = 0.045;
    g.connect(masterGain);

    var oscA = audioCtx.createOscillator();
    var oscB = audioCtx.createOscillator();
    oscA.type = "square";
    oscB.type = "square";
    oscA.frequency.value = 110;
    oscB.frequency.value = 146.83;

    var gA = audioCtx.createGain();
    var gB = audioCtx.createGain();
    gA.gain.value = 0.7;
    gB.gain.value = 0.05;
    oscA.connect(gA);
    oscB.connect(gB);
    gA.connect(g);
    gB.connect(g);
    oscA.start();
    oscB.start();

    bed = { oscA: oscA, oscB: oscB, gA: gA, gB: gB, g: g, step: -1 };
  }

  function updateBed(now) {
    if (!bed || !audioCtx) return;
    var step = Math.floor(now / 380) % 4;
    if (step === bed.step) return;
    bed.step = step;
    var a = step % 2 === 0;
    bed.gA.gain.setTargetAtTime(a ? 0.7 : 0.08, audioCtx.currentTime, 0.03);
    bed.gB.gain.setTargetAtTime(a ? 0.08 : 0.7, audioCtx.currentTime, 0.03);
  }

  function duckBed(isPaused) {
    if (!bed || !audioCtx) return;
    bed.g.gain.setTargetAtTime(isPaused ? 0.012 : 0.045, audioCtx.currentTime, 0.08);
  }

  function startLockTone() {
    if (!audioCtx || lockTone) return;
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 196;
    g.gain.value = 0;
    osc.connect(g);
    g.connect(masterGain);
    osc.start();
    lockTone = { osc: osc, g: g };
  }

  function updateLockTone() {
    if (!lockTone || !audioCtx) return;
    var freq = 196 + lockMeter * 392;
    lockTone.osc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.04);
    var vol = 0;
    if (!paused && lockMeter > 0.02) {
      vol =
        locked && lockMeter > 0.92
          ? 0.07 + 0.03 * Math.sin(performance.now() / 80)
          : 0.045;
    }
    lockTone.g.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
  }

  function stopLockTone() {
    if (!lockTone) return;
    try {
      lockTone.osc.stop();
    } catch (err) {}
    lockTone = null;
  }

  function stopBed() {
    if (!bed) return;
    try {
      bed.oscA.stop();
      bed.oscB.stop();
    } catch (err) {}
    bed = null;
  }

  function playNoiseBurst() {
    if (!audioCtx) return;
    var dur = 0.18;
    var buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate);
    var data = buffer.getChannelData(0);
    var i;
    for (i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    var src = audioCtx.createBufferSource();
    var g = audioCtx.createGain();
    src.buffer = buffer;
    g.gain.value = 0.12;
    src.connect(g);
    g.connect(masterGain);
    src.start();
  }

  function playArpeggio() {
    if (!audioCtx) return;
    var notes = [523.25, 659.25, 783.99];
    notes.forEach(function (freq, i) {
      var osc = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      var t = audioCtx.currentTime + i * 0.07;
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  function playKill() {
    playNoiseBurst();
    playArpeggio();
  }

  function playLost() {
    if (!audioCtx) return;
    var osc = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    var t = audioCtx.currentTime;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.55);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.58);
  }

  function onOrient(event) {
    if (event.beta == null || event.gamma == null) return;
    gotOrientation = true;
    rawBeta = event.beta;
    rawGamma = event.gamma;
  }

  function startSensors() {
    if (orientationListening) return;
    window.addEventListener("deviceorientation", onOrient);
    orientationListening = true;
  }

  function stopSensors() {
    if (!orientationListening) return;
    window.removeEventListener("deviceorientation", onOrient);
    orientationListening = false;
  }

  function requestOrientation() {
    return new Promise(function (resolve) {
      if (typeof DeviceOrientationEvent === "undefined") {
        resolve(false);
        return;
      }
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then(function (state) {
            resolve(state === "granted");
          })
          .catch(function () {
            resolve(false);
          });
      } else {
        resolve(true);
      }
    });
  }

  function lockRadius() {
    if (wave <= 3) return BASE_RADIUS;
    return Math.max(38, BASE_RADIUS - (wave - 3) * 2.5);
  }

  function spawnBandit() {
    var patterns = ["orbit", "figure8", "zigzag", "hoverdash", "spiral"];
    var pattern = patterns[Math.floor(rng() * patterns.length)];
    bandit = {
      pattern: pattern,
      secondary: rng() > 0.5,
      t: 0,
      cx: 220 + rng() * 160,
      cy: 250 + rng() * 140,
      x: 300,
      y: 320,
      rx: 70 + rng() * 80,
      ry: 50 + rng() * 55,
      phase: rng() * Math.PI * 2,
      speed: 1.05 + wave * 0.16,
      jinkEvery: Math.max(0.9, 3.8 - wave * 0.28),
      jinkTimer: 1.1 + rng() * 1.4,
      jinkX: 0,
      jinkY: 0,
      jinkAge: 0,
      dash: 0,
      dashDir: 1,
      hoverT: 0,
    };
    lockMeter = 0;
    unlockedTime = 0;
    grace = SPAWN_GRACE;
    locked = false;
  }

  function updateBandit(dt) {
    if (!bandit) return;
    bandit.t += dt * bandit.speed;
    bandit.jinkTimer -= dt;
    bandit.jinkAge = Math.max(0, bandit.jinkAge - dt);

    var t = bandit.t + bandit.phase;
    var x = bandit.cx;
    var y = bandit.cy;

    switch (bandit.pattern) {
      case "orbit":
        x = bandit.cx + Math.cos(t) * bandit.rx;
        y = bandit.cy + Math.sin(t) * bandit.ry;
        break;
      case "figure8":
        x = bandit.cx + Math.sin(t) * bandit.rx;
        y = bandit.cy + Math.sin(t * 2) * bandit.ry * 0.7;
        break;
      case "zigzag":
        x = bandit.cx + Math.sin(t * 2.4) * bandit.rx;
        y = bandit.cy + (Math.asin(Math.sin(t * 1.3)) / (Math.PI / 2)) * bandit.ry;
        break;
      case "hoverdash":
        bandit.hoverT += dt;
        if (bandit.dash > 0) {
          bandit.dash -= dt;
          x = bandit.cx + bandit.dashDir * (1 - Math.max(0, bandit.dash) / 0.32) * bandit.rx;
          y = bandit.cy + Math.sin(t * 0.8) * 18;
        } else {
          x = bandit.cx + Math.sin(t * 0.35) * 14;
          y = bandit.cy + Math.cos(t * 0.4) * 14;
          if (bandit.hoverT > 0.95) {
            bandit.hoverT = 0;
            bandit.dash = 0.32;
            bandit.dashDir = rng() > 0.5 ? 1 : -1;
            bandit.cx = clamp(bandit.cx + bandit.dashDir * 36, 160, 440);
          }
        }
        break;
      default:
        var r = 40 + (Math.sin(t * 0.35) * 0.5 + 0.5) * Math.min(bandit.rx, 110);
        x = bandit.cx + Math.cos(t * 1.4) * r;
        y = bandit.cy + Math.sin(t * 1.4) * r * 0.75;
        break;
    }

    if (bandit.secondary) {
      x += Math.sin(t * 0.55) * 18;
      y += Math.cos(t * 0.4) * 14;
    }

    if (bandit.jinkTimer <= 0) {
      bandit.jinkTimer = bandit.jinkEvery * (0.7 + rng() * 0.6);
      bandit.jinkX = (rng() - 0.5) * 140;
      bandit.jinkY = (rng() - 0.5) * 110;
      bandit.jinkAge = 0.45;
    }

    var jAmt = bandit.jinkAge / 0.45;
    x += bandit.jinkX * jAmt;
    y += bandit.jinkY * jAmt;

    bandit.x = clamp(x, TARGET_PAD_X, SIZE - TARGET_PAD_X);
    bandit.y = clamp(y, TARGET_TOP, SIZE - TARGET_BOTTOM);
  }

  function updateAim(dt) {
    if (demoMode) {
      if (keys.ArrowLeft) demoX -= DEMO_SPEED * dt;
      if (keys.ArrowRight) demoX += DEMO_SPEED * dt;
      if (keys.ArrowUp) demoY -= DEMO_SPEED * dt;
      if (keys.ArrowDown) demoY += DEMO_SPEED * dt;
      demoX = clamp(demoX, AIM_PAD, SIZE - AIM_PAD);
      demoY = clamp(demoY, AIM_PAD, SIZE - AIM_PAD);
      targetAimX = demoX;
      targetAimY = demoY;
    } else {
      targetAimX = clamp(300 + deadzone(rawGamma - gamma0, DEADZONE) * SENSITIVITY, AIM_PAD, SIZE - AIM_PAD);
      targetAimY = clamp(300 + deadzone(rawBeta - beta0, DEADZONE) * SENSITIVITY, AIM_PAD, SIZE - AIM_PAD);
    }
    aimX += (targetAimX - aimX) * AIM_LERP;
    aimY += (targetAimY - aimY) * AIM_LERP;
  }

  function killBandit() {
    var bonus = Math.round((1 - unlockedTime / LOST_CONTACT) * 20);
    score += 100 * wave + bonus;
    if (score > best) {
      best = score;
      writeBest(best);
    }
    wave += 1;
    killFlash = 0.45;
    playKill();
    spawnBandit();
  }

  function finishRun() {
    stopLoop();
    stopSensors();
    stopLockTone();
    duckBed(true);
    playLost();
    if (score > best) {
      best = score;
      writeBest(best);
    }
    updateBestReadout();
    if (overStats) {
      overStats.innerHTML =
        "SCORE " + pad(score, 5) + "<br>WAVE " + pad(wave, 2) + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function updateSim(dt) {
    if (!bandit) return;
    updateBandit(dt);
    killFlash = Math.max(0, killFlash - dt);

    var radius = lockRadius();
    var dist = hypot(aimX - bandit.x, aimY - bandit.y);
    locked = dist < radius;

    if (grace > 0) {
      grace -= dt;
      if (locked) lockMeter = Math.min(1, lockMeter + dt / LOCK_FILL);
      else lockMeter = Math.max(0, lockMeter - dt * LOCK_DECAY);
      return;
    }

    if (locked) {
      lockMeter += dt / LOCK_FILL;
      unlockedTime = 0;
      if (lockMeter >= 1) {
        lockMeter = 1;
        killBandit();
      }
    } else {
      lockMeter = Math.max(0, lockMeter - dt * LOCK_DECAY);
      unlockedTime += dt;
      if (unlockedTime >= LOST_CONTACT) finishRun();
    }
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

  function drawDiamond(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y - r);
    c.lineTo(x + r, y);
    c.lineTo(x, y + r);
    c.lineTo(x - r, y);
    c.closePath();
    c.stroke();
  }

  function drawLockBox(c, x, y, half) {
    var corner = 11;
    c.beginPath();
    c.moveTo(x - half, y - half + corner);
    c.lineTo(x - half, y - half);
    c.lineTo(x - half + corner, y - half);
    c.moveTo(x + half - corner, y - half);
    c.lineTo(x + half, y - half);
    c.lineTo(x + half, y - half + corner);
    c.moveTo(x + half, y + half - corner);
    c.lineTo(x + half, y + half);
    c.lineTo(x + half - corner, y + half);
    c.moveTo(x - half + corner, y + half);
    c.lineTo(x - half, y + half);
    c.lineTo(x - half, y + half - corner);
    c.stroke();
  }

  function drawPipper(c, x, y) {
    c.strokeStyle = CYAN;
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
    c.fillStyle = CYAN;
    c.fillRect(x - 1.5, y - 1.5, 3, 3);
  }

  function drawHud() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var dpr = canvas.width / SIZE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var y;
    ctx.fillStyle = "rgba(0, 255, 136, 0.035)";
    for (y = 0; y < SIZE; y += 4) ctx.fillRect(0, y, SIZE, 1);

    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    drawCorners(ctx);

    ctx.font = "bold 18px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    ctx.fillStyle = GREEN;
    ctx.textAlign = "left";
    ctx.fillText("WAVE " + pad(wave, 2), 24, 36);
    ctx.textAlign = "right";
    ctx.fillText("SCORE " + pad(score, 5), 576, 36);

    if (demoMode) {
      ctx.textAlign = "center";
      ctx.fillStyle = AMBER;
      ctx.fillText("DEMO", 300, 36);
    }

    var status = "TRACKING";
    var statusColor = AMBER;
    if (killFlash > 0) {
      status = "FOX";
      statusColor = RED;
    } else if (locked) {
      status = "LOCK";
      statusColor = RED;
    }
    ctx.fillStyle = statusColor;
    ctx.textAlign = "center";
    ctx.font = "bold 22px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    ctx.fillText(status, 300, 64);

    var barX = 120;
    var barY = 76;
    var barW = 360;
    var barH = 8;
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = locked || killFlash > 0 ? RED : AMBER;
    ctx.fillRect(barX + 1, barY + 1, (barW - 2) * clamp(lockMeter, 0, 1), barH - 2);

    if (bandit) {
      var dist = hypot(aimX - bandit.x, aimY - bandit.y);
      var radius = lockRadius();
      ctx.strokeStyle = locked || killFlash > 0 ? RED : GREEN;
      ctx.lineWidth = 2;
      drawDiamond(ctx, bandit.x, bandit.y, 14);
      if (dist < radius * 1.65) {
        drawLockBox(ctx, bandit.x, bandit.y, 34 + (1 - clamp(lockMeter, 0, 1)) * 8);
      }
    }

    drawPipper(ctx, aimX, aimY);

    if (!paused && grace <= 0 && unlockedTime > 2.2) {
      ctx.fillStyle = RED;
      ctx.font = "bold 16px ui-monospace, SF Mono, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("CONTACT " + Math.max(0, LOST_CONTACT - unlockedTime).toFixed(1), 300, 580);
    }
  }

  function tick(now) {
    if (!running) return;
    if (!lastTs) lastTs = now;
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;

    updateAim(dt);
    if (!paused) updateSim(dt);
    drawHud();
    updateBed(now);
    updateLockTone();

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

  function resetRunState() {
    rng = mulberry32(Date.now() >>> 0);
    wave = 1;
    score = 0;
    lockMeter = 0;
    unlockedTime = 0;
    grace = SPAWN_GRACE;
    locked = false;
    killFlash = 0;
    aimX = 300;
    aimY = 300;
    targetAimX = 300;
    targetAimY = 300;
    demoX = 300;
    demoY = 300;
    spawnBandit();
  }

  function beginSession() {
    ensureAudio();
    startBed();
    startLockTone();
    duckBed(false);
    requestOrientation().then(function (ok) {
      demoMode = !ok;
      gotOrientation = false;
      startSensors();
      if (calibrateCopy) {
        calibrateCopy.textContent = demoMode
          ? "DEMO MODE. Arrows aim. Enter to start."
          : "Look forward. Enter to zero the pipper.";
      }
      navigateTo("calibrate");
    });
  }

  function startHunt() {
    if (!demoMode && !gotOrientation) demoMode = true;
    beta0 = rawBeta;
    gamma0 = rawGamma;
    resetRunState();
    paused = false;
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    startLoop();
  }

  function pauseGame() {
    if (!running || paused) return;
    paused = true;
    pauseOverlay.classList.remove("hidden");
    duckBed(true);
    focusFirst(pauseOverlay);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    pauseOverlay.classList.add("hidden");
    duckBed(false);
    lastTs = 0;
  }

  function quitToTitle() {
    stopLoop();
    stopSensors();
    stopLockTone();
    stopBed();
    paused = false;
    pauseOverlay.classList.add("hidden");
    updateBestReadout();
    navigateTo("home");
  }

  function setMuted(value) {
    muted = value;
    writeMuted(muted);
    updateMuteButton();
    applyMasterMute();
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
      case "again":
        beginSession();
        break;
      case "calibrate":
        startHunt();
        break;
      case "resume":
        resumeGame();
        break;
      case "quit":
        quitToTitle();
        break;
      case "mute":
        setMuted(!muted);
        break;
      default:
        break;
    }
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "play" && !paused) {
      if (event.key === DPAD.SELECT) {
        event.preventDefault();
        pauseGame();
        return;
      }
      if (keys.hasOwnProperty(event.key)) {
        event.preventDefault();
        keys[event.key] = true;
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

  document.addEventListener("keyup", function (event) {
    if (keys.hasOwnProperty(event.key)) keys[event.key] = false;
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
  muted = readMuted();
  updateBestReadout();
  updateMuteButton();
  collectScreens();
  fitCanvas();
  navigateTo("home");
})();
