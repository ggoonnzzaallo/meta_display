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
  var TARGET_PAD_X = 48;
  var TARGET_TOP = 108;
  var TARGET_BOTTOM = 72;
  var SENSITIVITY = 14;
  var COMPLEMENT = 0.9;
  var LOCK_FILL = 2.5;
  var LOCK_DECAY = 0.4;
  var LOST_CONTACT = 5;
  var SPAWN_GRACE = 1.2;
  var BASE_RADIUS = 64;
  var DEMO_LOOK_SPEED = 90;
  var BEST_KEY = "strike-best";
  var SAMPLE_MAX = 16;
  var MAX_AMMO = 3;
  var RELOAD_S = 1.2;
  var MAX_PARTICLES = 24;
  var MAX_TRAIL = 8;

  var GREEN = "#00FF88";
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
  var calibrateCopy = document.getElementById("calibrate-copy");
  var sensorDebug = document.getElementById("sensor-debug");
  var overStats = document.getElementById("over-stats");

  var keys = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
  };

  var demoMode = true;
  var gotOrientation = false;
  var gotMotion = false;
  var gotGravity = false;
  var orientationListening = false;
  var motionListening = false;
  var rawAlpha = 0;
  var rawBeta = 0;
  var rawGamma = 0;
  var rawYawRate = 0;
  var rawPitchRate = 0;
  var rawRollRate = 0;
  var rawAx = 0;
  var rawAy = 0;
  var rawAz = 0;
  var gravPitch = 0;
  var gravRoll = 0;
  var alpha0 = 0;
  var beta0 = 0;
  var gamma0 = 0;
  var gravPitch0 = 0;
  var gravRoll0 = 0;
  var sampleAlpha = [];
  var sampleBeta = [];
  var sampleGamma = [];
  var orientHits = 0;
  var motionHits = 0;
  var orientTotal = 0;
  var motionTotal = 0;
  var orientHz = 0;
  var motionHz = 0;
  var hzStamp = 0;
  var debugRaf = 0;
  var horizAxis = "A+G";

  var lookYawDeg = 0;
  var lookPitchDeg = 0;
  var lookX = 0;
  var lookY = 0;
  var euroX = null;
  var euroY = null;

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
  var ammo = MAX_AMMO;
  var reloadT = 0;
  var missiles = [];
  var particles = [];
  var lockBeepT = 0;
  var audioCtx = null;
  var fireLockAt = 0;

  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = "0" + s;
    return s;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function hypot(ax, ay) {
    return Math.sqrt(ax * ax + ay * ay);
  }

  function wrapDelta(a, b) {
    var d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function meanAngle(values) {
    if (!values.length) return 0;
    var x = 0;
    var y = 0;
    var i;
    for (i = 0; i < values.length; i++) {
      var rad = (values[i] * Math.PI) / 180;
      x += Math.cos(rad);
      y += Math.sin(rad);
    }
    return (Math.atan2(y / values.length, x / values.length) * 180) / Math.PI;
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

  function createEuro(minCutoff, beta) {
    return {
      minCutoff: minCutoff,
      beta: beta,
      dcutoff: 1,
      x: null,
      dx: 0,
    };
  }

  function euroAlpha(dt, cutoff) {
    var tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  function filterEuro(filter, value, dt) {
    if (dt <= 0) return filter.x == null ? value : filter.x;
    if (filter.x == null) {
      filter.x = value;
      filter.dx = 0;
      return value;
    }
    var edx = (value - filter.x) / dt;
    var ad = euroAlpha(dt, filter.dcutoff);
    filter.dx = ad * edx + (1 - ad) * filter.dx;
    var cutoff = filter.minCutoff + filter.beta * Math.abs(filter.dx);
    var a = euroAlpha(dt, cutoff);
    filter.x = a * value + (1 - a) * filter.x;
    return filter.x;
  }

  function resetLookFilters() {
    euroX = createEuro(1.2, 0.04);
    euroY = createEuro(1.2, 0.04);
    lookYawDeg = 0;
    lookPitchDeg = 0;
    lookX = 0;
    lookY = 0;
  }

  function fmt(n) {
    if (n == null || !isFinite(n)) return "  —  ";
    var s = (Math.round(n * 10) / 10).toFixed(1);
    if (n >= 0) s = "+" + s;
    return s;
  }

  function sampleRange(values) {
    if (values.length < 2) return 0;
    var min = values[0];
    var max = values[0];
    var i;
    for (i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    return max - min;
  }

  function refreshHz(now) {
    if (!hzStamp) hzStamp = now;
    if (now - hzStamp < 1000) return;
    orientHz = orientHits;
    motionHz = motionHits;
    orientHits = 0;
    motionHits = 0;
    hzStamp = now;
  }

  function debugText() {
    return [
      (demoMode ? "DEMO" : "LIVE") +
        "  O:" +
        orientHz +
        "Hz/" +
        orientTotal +
        "  M:" +
        motionHz +
        "Hz/" +
        motionTotal,
      "A " + fmt(rawAlpha) + "  B " + fmt(rawBeta) + "  G " + fmt(rawGamma),
      "dA " +
        fmt(wrapDelta(rawAlpha, alpha0)) +
        "  dB " +
        fmt(wrapDelta(rawBeta, beta0)) +
        "  dG " +
        fmt(wrapDelta(rawGamma, gamma0)),
      "yaw " +
        fmt(lookYawDeg) +
        "  pit " +
        fmt(lookPitchDeg) +
        "  look " +
        Math.round(lookX) +
        "," +
        Math.round(lookY),
      "X:" +
        horizAxis +
        "  gyro:" +
        (gotMotion ? "Y" : "N") +
        "  grav:" +
        (gotGravity ? "Y" : "N") +
        "  rng A" +
        Math.round(sampleRange(sampleAlpha)) +
        " B" +
        Math.round(sampleRange(sampleBeta)) +
        " G" +
        Math.round(sampleRange(sampleGamma)),
      "ax " + fmt(rawAx) + "  ay " + fmt(rawAy) + "  az " + fmt(rawAz),
    ].join("\n");
  }

  function paintCalibrateDebug() {
    if (sensorDebug) sensorDebug.textContent = debugText();
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

  function pushSample(list, value) {
    list.push(value);
    if (list.length > SAMPLE_MAX) list.shift();
  }

  function onOrient(event) {
    if (event.alpha == null && event.beta == null && event.gamma == null) return;
    gotOrientation = true;
    orientHits += 1;
    orientTotal += 1;
    if (event.alpha != null) {
      rawAlpha = event.alpha;
      pushSample(sampleAlpha, rawAlpha);
    }
    if (event.beta != null) {
      rawBeta = event.beta;
      pushSample(sampleBeta, rawBeta);
    }
    if (event.gamma != null) {
      rawGamma = event.gamma;
      pushSample(sampleGamma, rawGamma);
    }
  }

  function onMotion(event) {
    motionHits += 1;
    motionTotal += 1;
    var accel = event.accelerationIncludingGravity;
    if (accel && (accel.x != null || accel.y != null || accel.z != null)) {
      gotGravity = true;
      rawAx = accel.x || 0;
      rawAy = accel.y || 0;
      rawAz = accel.z || 0;
      gravPitch = (Math.atan2(-rawAx, Math.sqrt(rawAy * rawAy + rawAz * rawAz)) * 180) / Math.PI;
      gravRoll = (Math.atan2(rawAy, rawAz) * 180) / Math.PI;
    }
    if (!event.rotationRate) return;
    var rate = event.rotationRate;
    if (rate.alpha == null && rate.beta == null && rate.gamma == null) return;
    gotMotion = true;
    rawYawRate = rate.alpha || 0;
    rawPitchRate = rate.beta || 0;
    rawRollRate = rate.gamma || 0;
  }

  function startSensors() {
    if (!orientationListening) {
      window.addEventListener("deviceorientation", onOrient);
      window.addEventListener("deviceorientationabsolute", onOrient);
      orientationListening = true;
    }
    if (!motionListening) {
      window.addEventListener("devicemotion", onMotion);
      motionListening = true;
    }
  }

  function stopSensors() {
    if (orientationListening) {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("deviceorientationabsolute", onOrient);
      orientationListening = false;
    }
    if (motionListening) {
      window.removeEventListener("devicemotion", onMotion);
      motionListening = false;
    }
    rawYawRate = 0;
    rawPitchRate = 0;
    rawRollRate = 0;
  }

  function requestPerm(api) {
    if (typeof api === "undefined" || api === null) {
      return Promise.resolve(false);
    }
    if (typeof api.requestPermission !== "function") {
      return Promise.resolve(true);
    }
    return api.requestPermission().then(
      function (state) {
        return state === "granted";
      },
      function () {
        return false;
      }
    );
  }

  function requestSensors() {
    return Promise.all([
      requestPerm(typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null),
      requestPerm(typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null),
    ]).then(function (pair) {
      return pair[0] || pair[1];
    });
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
      case "miss":
        tone(420, 0.08, "square", 0.06, 180);
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

  function updateLockTone(dt) {
    if (!running || paused || !locked) {
      lockBeepT = 0;
      return;
    }
    lockBeepT -= dt;
    if (lockBeepT > 0) return;
    lockBeepT = 0.32;
    tone(620 + lockMeter * 260, 0.07, "sine", 0.045);
  }

  function lockRadius() {
    if (wave <= 3) return BASE_RADIUS;
    return Math.max(46, BASE_RADIUS - (wave - 3) * 2);
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

  function banditScreen() {
    if (!bandit) return { x: 300, y: 320 };
    return { x: bandit.x - lookX, y: bandit.y - lookY };
  }

  function updateLook(dt) {
    if (demoMode) {
      if (keys.ArrowLeft) lookYawDeg -= DEMO_LOOK_SPEED * dt;
      if (keys.ArrowRight) lookYawDeg += DEMO_LOOK_SPEED * dt;
      if (keys.ArrowUp) lookPitchDeg -= DEMO_LOOK_SPEED * dt;
      if (keys.ArrowDown) lookPitchDeg += DEMO_LOOK_SPEED * dt;
      lookYawDeg = clamp(lookYawDeg, -28, 28);
      lookPitchDeg = clamp(lookPitchDeg, -28, 28);
      horizAxis = "DEMO";
    } else {
      var dA = wrapDelta(rawAlpha, alpha0);
      var dB = wrapDelta(rawBeta, beta0);
      var dG = wrapDelta(rawGamma, gamma0);
      if (!gotOrientation && gotGravity) {
        dB = gravPitch - gravPitch0;
        dG = gravRoll - gravRoll0;
        horizAxis = "GRAV";
      } else {
        horizAxis = "A+G";
      }
      var orientYaw = dA + dG;
      var orientPitch = dB;
      if (gotMotion && (rawYawRate || rawPitchRate || rawRollRate)) {
        lookYawDeg =
          COMPLEMENT * (lookYawDeg + (rawYawRate + rawRollRate) * dt) +
          (1 - COMPLEMENT) * orientYaw;
        lookPitchDeg =
          COMPLEMENT * (lookPitchDeg + rawPitchRate * dt) + (1 - COMPLEMENT) * orientPitch;
      } else {
        lookYawDeg = orientYaw;
        lookPitchDeg = orientPitch;
      }
    }

    lookX = filterEuro(euroX, lookYawDeg * SENSITIVITY, dt);
    lookY = filterEuro(euroY, lookPitchDeg * SENSITIVITY, dt);
  }

  function burst(x, y, colors, count, big) {
    var i;
    for (i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
      var a = rng() * Math.PI * 2;
      var sp = 50 + rng() * (big ? 240 : 130);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.22 + rng() * 0.2,
        age: 0,
        r: (big ? 7 : 4) + rng() * 8,
        color: colors[Math.floor(rng() * colors.length)],
        kind: rng() > 0.45 ? "star" : "ring",
      });
    }
  }

  function explodeHit(x, y) {
    burst(x, y, [GOLD, ORANGE, CREAM, RED], 14, true);
    playSfx("boom");
    killFlash = 0.4;
  }

  function explodeMiss(x, y) {
    burst(x, y, [CYAN, CREAM, AMBER], 8, false);
    playSfx("miss");
  }

  function killBandit() {
    var bonus = Math.round((1 - unlockedTime / LOST_CONTACT) * 20);
    score += 100 * wave + bonus;
    if (score > best) {
      best = score;
      writeBest(best);
    }
    wave += 1;
    missiles = [];
    spawnBandit();
  }

  function spawnMissile(homing) {
    missiles.push({
      x: 300,
      y: 548,
      vx: 0,
      vy: -460,
      homing: homing,
      life: homing ? 1.35 : 0.52,
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
    spawnMissile(locked);
    playSfx("launch");
  }

  function updateMissiles(dt) {
    var next = [];
    var i;
    for (i = 0; i < missiles.length; i++) {
      var m = missiles[i];
      m.life -= dt;
      if (m.homing && bandit) {
        var s = banditScreen();
        var dx = s.x - m.x;
        var dy = s.y - m.y;
        var d = hypot(dx, dy) || 1;
        var speed = 500;
        m.vx = (dx / d) * speed;
        m.vy = (dy / d) * speed;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > MAX_TRAIL) m.trail.shift();
        if (d < 30) {
          explodeHit(s.x, s.y);
          killBandit();
          return;
        }
        if (m.life > 0) next.push(m);
        else explodeMiss(m.x, m.y);
      } else {
        m.vy = -540;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > MAX_TRAIL) m.trail.shift();
        if (m.y < 170 || m.life <= 0) explodeMiss(m.x, m.y);
        else next.push(m);
      }
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

  function finishRun() {
    stopLoop();
    stopSensors();
    muteAudio();
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
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloadT = 0;
        ammo = MAX_AMMO;
      }
    }

    var screen = banditScreen();
    var radius = lockRadius();
    var dist = hypot(300 - screen.x, 300 - screen.y);
    locked = dist < radius;

    if (grace > 0) {
      grace -= dt;
      if (locked) lockMeter = Math.min(1, lockMeter + dt / LOCK_FILL);
      else lockMeter = Math.max(0, lockMeter - dt * LOCK_DECAY);
    } else if (locked) {
      lockMeter = Math.min(1, lockMeter + dt / LOCK_FILL);
      unlockedTime = 0;
    } else {
      lockMeter = Math.max(0, lockMeter - dt * LOCK_DECAY);
      unlockedTime += dt;
      if (unlockedTime >= LOST_CONTACT) {
        finishRun();
        return;
      }
    }

    updateMissiles(dt);
    updateParticles(dt);
    updateLockTone(dt);
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
    c.lineTo(x + half, y + half - corner);
    c.moveTo(x - half + corner, y + half);
    c.lineTo(x - half, y + half);
    c.lineTo(x - half, y + half - corner);
    c.stroke();
  }

  function drawPipper(c) {
    var x = 300;
    var y = 300;
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

  function drawOffscreenCue(c, sx, sy) {
    var mx = clamp(sx, 36, SIZE - 36);
    var my = clamp(sy, 100, SIZE - 36);
    var dx = sx - 300;
    var dy = sy - 300;
    var len = hypot(dx, dy) || 1;
    c.strokeStyle = AMBER;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(mx - (dx / len) * 10, my - (dy / len) * 10);
    c.lineTo(mx, my);
    c.lineTo(mx - (dx / len) * 10 + (-dy / len) * 6, my - (dy / len) * 10 + (dx / len) * 6);
    c.moveTo(mx, my);
    c.lineTo(mx - (dx / len) * 10 - (-dy / len) * 6, my - (dy / len) * 10 - (dx / len) * 6);
    c.stroke();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBandit(c, x, y, hot) {
    var spin = (performance.now() / 140) % (Math.PI * 2);
    c.save();
    c.translate(x, y);

    c.fillStyle = hot ? RED : ORANGE;
    c.beginPath();
    c.ellipse(-22, -2, 11, 4, 0, 0, Math.PI * 2);
    c.ellipse(22, -2, 11, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = CREAM;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(-22, -2, 10, spin, spin + Math.PI);
    c.arc(22, -2, 10, -spin, -spin + Math.PI);
    c.stroke();

    c.fillStyle = hot ? "#FF6A6A" : "#FF8A4A";
    roundRect(c, -18, -10, 36, 22, 8);
    c.fill();
    c.strokeStyle = BODY;
    c.lineWidth = 3;
    c.stroke();

    c.fillStyle = hot ? GOLD : CYAN;
    c.beginPath();
    c.ellipse(0, -2, 9, 7, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = CREAM;
    c.lineWidth = 2;
    c.stroke();

    c.fillStyle = AMBER;
    c.beginPath();
    c.moveTo(-6, 12);
    c.lineTo(0, 20);
    c.lineTo(6, 12);
    c.closePath();
    c.fill();

    c.restore();
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
    if (reloadT > 0) {
      status = "RELOAD";
      statusColor = CYAN;
    } else if (ammo <= 0) {
      status = "EMPTY";
      statusColor = AMBER;
    } else if (killFlash > 0) {
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
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = locked || killFlash > 0 ? RED : AMBER;
    ctx.fillRect(barX + 1, barY + 1, (barW - 2) * clamp(lockMeter, 0, 1), barH - 2);

    if (bandit) {
      var screen = banditScreen();
      var onScreen =
        screen.x > 20 && screen.x < SIZE - 20 && screen.y > 92 && screen.y < SIZE - 20;
      var radius = lockRadius();
      var dist = hypot(300 - screen.x, 300 - screen.y);
      if (onScreen) {
        drawBandit(ctx, screen.x, screen.y, locked || killFlash > 0);
        if (dist < radius * 1.65) {
          ctx.strokeStyle = locked || killFlash > 0 ? RED : GREEN;
          ctx.lineWidth = 2;
          drawLockBox(ctx, screen.x, screen.y, 38 + (1 - clamp(lockMeter, 0, 1)) * 8);
        }
      } else {
        drawOffscreenCue(ctx, screen.x, screen.y);
      }
    }

    var i;
    for (i = 0; i < missiles.length; i++) drawMissile(ctx, missiles[i]);
    drawParticles(ctx);
    drawPipper(ctx);
    drawAmmo(ctx);

    if (!paused && grace <= 0 && unlockedTime > 2.2) {
      ctx.fillStyle = RED;
      ctx.font = "bold 16px ui-monospace, SF Mono, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("CONTACT " + Math.max(0, LOST_CONTACT - unlockedTime).toFixed(1), 300, 540);
    }
  }

  function tick(now) {
    if (!running) return;
    if (!lastTs) lastTs = now;
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;

    refreshHz(now);
    updateLook(dt);
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

  function resetRunState() {
    rng = mulberry32(Date.now() >>> 0);
    wave = 1;
    score = 0;
    lockMeter = 0;
    unlockedTime = 0;
    grace = SPAWN_GRACE;
    locked = false;
    killFlash = 0;
    ammo = MAX_AMMO;
    reloadT = 0;
    missiles = [];
    particles = [];
    lockBeepT = 0;
    resetLookFilters();
    spawnBandit();
  }

  function stopDebugLoop() {
    if (debugRaf) cancelAnimationFrame(debugRaf);
    debugRaf = 0;
  }

  function startDebugLoop() {
    if (debugRaf) return;
    var last = 0;
    function pulse(now) {
      if (currentScreen !== "calibrate") {
        debugRaf = 0;
        return;
      }
      if (!last) last = now;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      refreshHz(now);
      updateLook(dt);
      paintCalibrateDebug();
      debugRaf = requestAnimationFrame(pulse);
    }
    debugRaf = requestAnimationFrame(pulse);
  }

  function beginSession() {
    ensureAudio();
    requestSensors().then(function (ok) {
      demoMode = !ok;
      gotOrientation = false;
      gotMotion = false;
      gotGravity = false;
      sampleAlpha = [];
      sampleBeta = [];
      sampleGamma = [];
      orientHits = 0;
      motionHits = 0;
      orientTotal = 0;
      motionTotal = 0;
      orientHz = 0;
      motionHz = 0;
      hzStamp = 0;
      resetLookFilters();
      startSensors();
      if (calibrateCopy) {
        calibrateCopy.textContent = demoMode
          ? "DEMO MODE. Arrows look around. Enter to start."
          : "Move your head. Numbers should change. Then look forward and Enter.";
      }
      navigateTo("calibrate");
      startDebugLoop();
    });
  }

  function startHunt() {
    if (!demoMode && !gotOrientation && !gotMotion && !gotGravity) demoMode = true;
    alpha0 = sampleAlpha.length ? meanAngle(sampleAlpha) : rawAlpha;
    beta0 = sampleBeta.length ? meanAngle(sampleBeta) : rawBeta;
    gamma0 = sampleGamma.length ? meanAngle(sampleGamma) : rawGamma;
    gravPitch0 = gravPitch;
    gravRoll0 = gravRoll;
    stopDebugLoop();
    resetRunState();
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
    stopDebugLoop();
    stopSensors();
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
      case "again":
        beginSession();
        break;
      case "calibrate":
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
  updateBestReadout();
  collectScreens();
  fitCanvas();
  navigateTo("home");
})();
