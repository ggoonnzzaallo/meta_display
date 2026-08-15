(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var BUILD = "v30";
  var SIZE = 600;
  var YAW_MIN = -10;
  var YAW_MAX = 10;
  var PITCH_MIN = 2;
  var PITCH_MAX = 9;
  var PX_PER_DEG = 16;
  var PITCH_SIGN = 1;
  var ROLL_SIGN = 1;
  var LOOK_SCALE = 1;
  var SPIKE_DEG = 50;
  var ROLL_DEADZONE = 2.5;
  var ROLL_SETTLE = 18;
  var HEAD_YAW_MAX = 18;
  var HEAD_PITCH_MIN = -16;
  var HEAD_PITCH_MAX = 16;
  var HEAD_ROLL_MAX = 35;
  var LOCK_FILL = 0.4;
  var LOCK_DECAY = 0.7;
  var BOOM_TIME = 0.85;
  var LOST_CONTACT = 5;
  var SPAWN_GRACE = 1.2;
  var BASE_RADIUS = 88;
  var DEMO_LOOK_SPEED = 18;
  var BEST_KEY = "lockon-best";
  var SAMPLE_MAX = 16;

  var GREEN = "#00FF88";
  var AMBER = "#FFB000";
  var RED = "#FF3333";
  var CYAN = "#00D4FF";

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
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
  var lastEulerYaw = 0;
  var lastEulerPitch = 0;
  var lastEulerRoll = 0;
  var rollSettle = 0;
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
  var horizAxis = "A";
  var vertAxis = "G";
  var zerosSet = false;

  var lookYawDeg = 0;
  var lookPitchDeg = 0;
  var lookRollDeg = 0;
  var lookX = 0;
  var lookY = 0;
  var pipperX = 300;
  var pipperY = 300;
  var euroX = null;
  var euroY = null;
  var euroZ = null;

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
  var zeroFlash = 0;
  var bandit = null;
  var boom = null;

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
    euroX = createEuro(4.5, 0.2);
    euroY = createEuro(4.5, 0.2);
    euroZ = createEuro(4.5, 0.2);
    lookYawDeg = 0;
    lookPitchDeg = 0;
    lookRollDeg = 0;
    lookX = 0;
    lookY = 0;
    pipperX = 300;
    pipperY = 300;
    lastEulerYaw = 0;
    lastEulerPitch = 0;
    lastEulerRoll = 0;
    rollSettle = 0;
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
      BUILD +
        "  " +
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
      zerosSet
        ? "dA " +
          fmt(wrapDelta(rawAlpha, alpha0)) +
          "  dB " +
          fmt(wrapDelta(rawBeta, beta0)) +
          "  dG " +
          fmt(wrapDelta(rawGamma, gamma0))
        : "zero UNSET — d* equals raw until Enter",
      "zero A " + fmt(alpha0) + "  B " + fmt(beta0) + "  G " + fmt(gamma0),
      "yaw " +
        fmt(lookYawDeg) +
        "  pit " +
        fmt(lookPitchDeg) +
        "  rol " +
        fmt(lookRollDeg) +
        "  pipper FIXED",
      "look yaw=dA  pit=+dB  rol=grav",
      "aim X:" +
        horizAxis +
        " Y:" +
        vertAxis +
        "  gyro:" +
        (gotMotion ? "Y" : "N") +
        "  grav:" +
        (gotGravity ? "Y" : "N"),
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

  function lockRadius() {
    if (wave <= 3) return BASE_RADIUS;
    return Math.max(46, BASE_RADIUS - (wave - 3) * 2);
  }

  function clampTarget(yaw, pitch) {
    return {
      yaw: clamp(yaw, YAW_MIN, YAW_MAX),
      pitch: clamp(pitch, PITCH_MIN, PITCH_MAX),
    };
  }

  function readHeadRoll() {
    if (gotGravity) return wrapDelta(gravRoll, gravRoll0);
    return wrapDelta(rawGamma, gamma0);
  }

  function rebaseRollZero() {
    if (gotGravity) gravRoll0 = gravRoll;
    else gamma0 = rawGamma;
    lastEulerRoll = 0;
  }

  function clampHead(yaw, pitch, roll) {
    return {
      yaw: clamp(yaw, -HEAD_YAW_MAX, HEAD_YAW_MAX),
      pitch: clamp(pitch, HEAD_PITCH_MIN, HEAD_PITCH_MAX),
      roll: clamp(roll == null ? 0 : roll, -HEAD_ROLL_MAX, HEAD_ROLL_MAX),
    };
  }

  var HOLDS = [
    { name: "CENTER", yaw: 0, pitch: 5 },
    { name: "RIGHT", yaw: 7, pitch: 5 },
    { name: "LEFT", yaw: -7, pitch: 5 },
    { name: "UP", yaw: 0, pitch: 8 },
    { name: "UP-R", yaw: 6, pitch: 7 },
    { name: "UP-L", yaw: -6, pitch: 7 },
  ];

  function spawnBandit() {
    var hold = HOLDS[(wave - 1) % HOLDS.length];
    bandit = {
      name: hold.name,
      yaw: hold.yaw,
      pitch: hold.pitch,
    };
    lockMeter = 0;
    unlockedTime = 0;
    grace = SPAWN_GRACE;
    locked = false;
  }

  function updateBandit() {}

  function worldToScreen(yaw, pitch) {
    return {
      x: 300 + (yaw - lookYawDeg) * PX_PER_DEG,
      y: 300 - (pitch - lookPitchDeg) * PX_PER_DEG,
    };
  }

  function banditScreen() {
    if (!bandit) return { x: 300, y: 300 };
    return worldToScreen(bandit.yaw, bandit.pitch);
  }

  function updateLook(dt) {
    var nextYaw;
    var nextPitch;
    var nextRoll = lookRollDeg;
    var useImu = gotOrientation || gotGravity;
    if (useImu) {
      demoMode = false;
      var dA = wrapDelta(rawAlpha, alpha0);
      var dB = wrapDelta(rawBeta, beta0);
      if (!gotOrientation && gotGravity) {
        nextYaw = gravRoll - gravRoll0;
        nextPitch = PITCH_SIGN * (gravPitch - gravPitch0);
        horizAxis = "GRAV";
        vertAxis = "GRAV";
      } else {
        var yaw = dA;
        var pitch = PITCH_SIGN * dB;
        var yawJump = Math.abs(wrapDelta(yaw, lastEulerYaw));
        var pitchJump = Math.abs(pitch - lastEulerPitch);
        if (
          (yawJump > SPIKE_DEG || pitchJump > SPIKE_DEG) &&
          (lastEulerYaw !== 0 || lastEulerPitch !== 0)
        ) {
          nextYaw = lookYawDeg;
          nextPitch = lookPitchDeg;
          horizAxis = "HOLD";
          vertAxis = "HOLD";
        } else {
          lastEulerYaw = yaw;
          lastEulerPitch = pitch;
          nextYaw = yaw;
          nextPitch = pitch;
          horizAxis = "A";
          vertAxis = "B";
        }
      }
      var roll = ROLL_SIGN * readHeadRoll();
      if (rollSettle > 0) {
        rollSettle -= 1;
        rebaseRollZero();
        nextRoll = 0;
        lookRollDeg = 0;
      } else if (Math.abs(roll) < ROLL_DEADZONE) {
        nextRoll = 0;
        lastEulerRoll = 0;
      } else if (Math.abs(roll - lastEulerRoll) > SPIKE_DEG && lastEulerRoll !== 0) {
        rebaseRollZero();
        nextRoll = 0;
      } else {
        lastEulerRoll = roll;
        nextRoll = roll;
      }
      var scale = zerosSet && currentScreen === "play" ? LOOK_SCALE : 1;
      nextYaw *= scale;
      nextPitch *= scale;
    } else {
      if (keys.ArrowLeft) lookYawDeg -= DEMO_LOOK_SPEED * dt;
      if (keys.ArrowRight) lookYawDeg += DEMO_LOOK_SPEED * dt;
      if (keys.ArrowUp) lookPitchDeg += DEMO_LOOK_SPEED * dt;
      if (keys.ArrowDown) lookPitchDeg -= DEMO_LOOK_SPEED * dt;
      nextYaw = lookYawDeg;
      nextPitch = lookPitchDeg;
      nextRoll = lookRollDeg;
      horizAxis = "DEMO";
      vertAxis = "DEMO";
    }

    var clamped = clampHead(nextYaw, nextPitch, nextRoll);
    lookYawDeg = filterEuro(euroX, clamped.yaw, dt);
    lookPitchDeg = filterEuro(euroY, clamped.pitch, dt);
    lookRollDeg = filterEuro(euroZ, clamped.roll, dt);
    clamped = clampHead(lookYawDeg, lookPitchDeg, lookRollDeg);
    lookYawDeg = clamped.yaw;
    lookPitchDeg = clamped.pitch;
    lookRollDeg = clamped.roll;
    lookX = lookYawDeg * PX_PER_DEG;
    lookY = lookPitchDeg * PX_PER_DEG;
    pipperX = 300;
    pipperY = 300;
  }

  function canFire() {
    return !paused && !boom && locked && lockMeter >= 1;
  }

  function startBoom(sx, sy) {
    var shards = [];
    var i;
    for (i = 0; i < 16; i++) {
      shards.push({
        ang: (i / 16) * Math.PI * 2 + rng() * 0.35,
        spd: 90 + rng() * 240,
        len: 10 + rng() * 18,
      });
    }
    boom = { t: 0, yaw: sx, pitch: sy, shards: shards };
    bandit = null;
    locked = false;
    lockMeter = 0;
  }

  function fire() {
    if (!canFire() || !bandit) return;
    var bonus = Math.round((1 - unlockedTime / LOST_CONTACT) * 20);
    score += 100 * wave + bonus;
    if (score > best) {
      best = score;
      writeBest(best);
    }
    wave += 1;
    killFlash = BOOM_TIME;
    startBoom(bandit.yaw, bandit.pitch);
  }

  function drawBoom(c) {
    if (!boom) return;
    var pos = worldToScreen(boom.yaw, boom.pitch);
    var bx = pos.x;
    var by = pos.y;
    var k = clamp(boom.t / BOOM_TIME, 0, 1);
    var flash = Math.max(0, 1 - k * 2.4);
    if (flash > 0) {
      c.fillStyle = "rgba(255, 80, 30, " + (flash * 0.28) + ")";
      c.fillRect(0, 0, SIZE, SIZE);
    }
    c.strokeStyle = k < 0.35 ? RED : AMBER;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(bx, by, 16 + k * 160, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(bx, by, 6 + k * 95, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = CYAN;
    c.lineWidth = 2;
    boom.shards.forEach(function (shard) {
      var dist = shard.spd * boom.t;
      var x1 = bx + Math.cos(shard.ang) * dist;
      var y1 = by + Math.sin(shard.ang) * dist;
      var x0 = bx + Math.cos(shard.ang) * Math.max(0, dist - shard.len);
      var y0 = by + Math.sin(shard.ang) * Math.max(0, dist - shard.len);
      c.globalAlpha = 1 - k;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    });
    c.globalAlpha = 1;
    c.fillStyle = RED;
    c.font = "bold 28px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    c.textAlign = "center";
    c.fillText("FOX", bx, by - 20 - k * 30);
  }

  function drawWorld(c) {
    var horizonY = 300 + lookPitchDeg * PX_PER_DEG;
    var groundTop = Math.max(92, horizonY);

    if (groundTop < SIZE) {
      c.fillStyle = "rgba(0, 255, 136, 0.055)";
      c.fillRect(0, groundTop, SIZE, SIZE - groundTop);
    }

    if (horizonY > 96 && horizonY < SIZE - 12) {
      c.strokeStyle = GREEN;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(28, horizonY);
      c.lineTo(SIZE - 28, horizonY);
      c.stroke();
      c.font = "bold 12px ui-monospace, SF Mono, Menlo, Consolas, monospace";
      c.fillStyle = GREEN;
      c.textAlign = "left";
      c.fillText("0", 32, horizonY - 6);
    }

    var pitches = [-20, -15, -10, -5, 5, 10, 15, 20];
    var i;
    c.strokeStyle = GREEN;
    c.fillStyle = GREEN;
    c.lineWidth = 2;
    c.font = "bold 12px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    c.textAlign = "right";
    for (i = 0; i < pitches.length; i++) {
      var pitch = pitches[i];
      var y = 300 - (pitch - lookPitchDeg) * PX_PER_DEG;
      if (y < 108 || y > SIZE - 24) continue;
      var half = pitch % 10 === 0 ? 46 : 28;
      c.beginPath();
      c.moveTo(300 - half, y);
      c.lineTo(300 - 18, y);
      c.moveTo(300 + 18, y);
      c.lineTo(300 + half, y);
      c.stroke();
      c.fillText(String(pitch), 300 - half - 8, y + 4);
    }

    var startYaw = Math.floor((lookYawDeg - 22) / 10) * 10;
    var yaw;
    c.textAlign = "center";
    for (yaw = startYaw; yaw <= lookYawDeg + 22; yaw += 10) {
      var x = 300 + (yaw - lookYawDeg) * PX_PER_DEG;
      if (x < 40 || x > SIZE - 40) continue;
      var major = yaw % 20 === 0;
      c.beginPath();
      c.moveTo(x, 118);
      c.lineTo(x, major ? 136 : 128);
      c.stroke();
      if (major) c.fillText(String(yaw), x, 150);
    }
  }

  function finishRun() {
    stopLoop();
    stopSensors();
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
    killFlash = Math.max(0, killFlash - dt);
    zeroFlash = Math.max(0, zeroFlash - dt);

    if (boom) {
      boom.t += dt;
      if (boom.t >= BOOM_TIME) {
        boom = null;
        spawnBandit();
      }
      return;
    }

    if (!bandit) return;
    updateBandit(dt);

    var screen = banditScreen();
    var radius = lockRadius();
    var dist = hypot(pipperX - screen.x, pipperY - screen.y);
    locked = dist < radius;

    if (grace > 0) {
      grace -= dt;
      if (locked) lockMeter = Math.min(1, lockMeter + dt / LOCK_FILL);
      else lockMeter = Math.max(0, lockMeter - dt * LOCK_DECAY);
      return;
    }

    if (locked) {
      lockMeter = Math.min(1, lockMeter + dt / LOCK_FILL);
      unlockedTime = 0;
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

  function drawPipper(c) {
    var x = pipperX;
    var y = pipperY;
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
    var dx = sx - pipperX;
    var dy = sy - pipperY;
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

  function drawHud() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var dpr = canvas.width / SIZE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var y;
    ctx.fillStyle = "rgba(0, 255, 136, 0.035)";
    for (y = 0; y < SIZE; y += 4) ctx.fillRect(0, y, SIZE, 1);

    ctx.save();
    ctx.translate(300, 300);
    ctx.rotate((-lookRollDeg * Math.PI) / 180);
    ctx.translate(-300, -300);
    drawWorld(ctx);
    drawBoom(ctx);

    if (bandit) {
      var screen = banditScreen();
      var onScreen =
        screen.x > 20 && screen.x < SIZE - 20 && screen.y > 92 && screen.y < SIZE - 20;
      var radius = lockRadius();
      var dist = hypot(pipperX - screen.x, pipperY - screen.y);
      if (onScreen) {
        ctx.strokeStyle = locked || killFlash > 0 ? RED : GREEN;
        ctx.lineWidth = 2;
        drawDiamond(ctx, screen.x, screen.y, 14);
        ctx.fillStyle = GREEN;
        ctx.font = "bold 14px ui-monospace, SF Mono, Menlo, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          bandit.name + "  Y" + Math.round(bandit.yaw) + " P" + Math.round(bandit.pitch),
          screen.x,
          screen.y + 28
        );
        if (dist < radius * 1.65) {
          drawLockBox(ctx, screen.x, screen.y, 34 + (1 - clamp(lockMeter, 0, 1)) * 8);
        }
      } else {
        drawOffscreenCue(ctx, screen.x, screen.y);
      }
    }
    ctx.restore();

    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    drawCorners(ctx);

    ctx.font = "bold 18px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    ctx.fillStyle = GREEN;
    ctx.textAlign = "left";
    ctx.fillText("WAVE " + pad(wave, 2) + "  " + BUILD, 24, 36);
    ctx.textAlign = "right";
    ctx.fillText("SCORE " + pad(score, 5), 576, 36);

    if (demoMode) {
      ctx.textAlign = "center";
      ctx.fillStyle = AMBER;
      ctx.fillText("DEMO", 300, 36);
    }

    if (zeroFlash > 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = CYAN;
      ctx.font = "bold 18px ui-monospace, SF Mono, Menlo, Consolas, monospace";
      ctx.fillText("ZEROED  YAW 0  PITCH 0", 300, 448);
    }

    var status = "TRACKING";
    var statusColor = AMBER;
    if (boom) {
      status = "FOX";
      statusColor = RED;
    } else if (canFire()) {
      status = "FIRE";
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
    ctx.fillStyle = boom || canFire() ? RED : locked ? AMBER : GREEN;
    ctx.fillRect(barX + 1, barY + 1, (barW - 2) * clamp(lockMeter, 0, 1), barH - 2);

    if (canFire()) {
      ctx.fillStyle = RED;
      ctx.font = "bold 16px ui-monospace, SF Mono, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("PINCH TO FIRE", 300, 108);
    }

    drawPipper(ctx);

    ctx.font = "14px ui-monospace, SF Mono, Menlo, Consolas, monospace";
    ctx.fillStyle = CYAN;
    ctx.textAlign = "left";
    var lines = debugText().split("\n");
    var i;
    for (i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 20, 470 + i * 18);
    }

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
    zeroFlash = 2.2;
    boom = null;
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
      zerosSet = false;
      alpha0 = 0;
      beta0 = 0;
      gamma0 = 0;
      resetLookFilters();
      startSensors();
      if (calibrateCopy) {
        calibrateCopy.textContent = demoMode
          ? "DEMO MODE. Arrows look around. SET ZERO starts the run."
          : "Look straight ahead. SET ZERO makes this pose yaw 0 and pitch 0.";
      }
      navigateTo("calibrate");
      startDebugLoop();
    });
  }

  function recentMean(values, fallback) {
    if (!values.length) return fallback;
    return meanAngle(values.slice(Math.max(0, values.length - 6)));
  }

  function startHunt() {
    if (!demoMode && !gotOrientation && !gotMotion && !gotGravity) demoMode = true;
    alpha0 = recentMean(sampleAlpha, rawAlpha);
    beta0 = recentMean(sampleBeta, rawBeta);
    gamma0 = recentMean(sampleGamma, rawGamma);
    gravPitch0 = gravPitch;
    gravRoll0 = gravRoll;
    lastEulerYaw = 0;
    lastEulerPitch = 0;
    lastEulerRoll = 0;
    rollSettle = ROLL_SETTLE;
    zerosSet = true;
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
    pauseOverlay.classList.remove("hidden");
    focusFirst(pauseOverlay);
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    pauseOverlay.classList.add("hidden");
    lastTs = 0;
  }

  function quitToTitle() {
    stopLoop();
    stopDebugLoop();
    stopSensors();
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
        if (canFire()) fire();
        else if (!boom) pauseGame();
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
  document.querySelectorAll(".build").forEach(function (el) {
    el.textContent = el.classList.contains("header-build") ? BUILD : "BUILD " + BUILD;
  });
  collectScreens();
  fitCanvas();
  navigateTo("home");
})();
