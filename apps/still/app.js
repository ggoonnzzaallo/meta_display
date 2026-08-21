(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var BUILD = "v4";
  var SETTINGS_KEY = "still-settings-v4";
  var PX_PER_DEG = 12;
  var PX_PER_M = 700;
  var SPIKE_DEG = 50;
  var MAX_Y_PX = 48;
  var SLEW_PX = 10;
  var GRAV_TAU = 0.35;
  var ACCEL_LEAK = 0.12;
  var PRESETS = [
    { id: "off", label: "OFF", algo: "off", pitchGain: 0, accelGain: 0, tau: 0.8, smooth: 0, predict: 0, pitchSign: 1 },
    { id: "u25", label: "UP .25", algo: "pitch", pitchGain: 0.25, accelGain: 0, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: 1 },
    { id: "u40", label: "UP .40", algo: "pitch", pitchGain: 0.4, accelGain: 0, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: 1 },
    { id: "u55", label: "UP .55", algo: "pitch", pitchGain: 0.55, accelGain: 0, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: 1 },
    { id: "u70", label: "UP .70", algo: "pitch", pitchGain: 0.7, accelGain: 0, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: 1 },
    { id: "u85", label: "UP .85", algo: "pitch", pitchGain: 0.85, accelGain: 0, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: 1 },
    { id: "band", label: "BAND", algo: "band", pitchGain: 0.7, accelGain: 0, tau: 0.28, smooth: 0.07, predict: 0.02, pitchSign: 1 },
    { id: "drop", label: "DROP", algo: "accel", pitchGain: 0, accelGain: 1, tau: 0.8, smooth: 0, predict: 0, pitchSign: 1 },
    { id: "mix", label: "MIX", algo: "mix", pitchGain: 0.5, accelGain: 0.6, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: 1 },
    { id: "inv", label: "INV", algo: "pitch", pitchGain: 0.7, accelGain: 0, tau: 0.8, smooth: 0.08, predict: 0.03, pitchSign: -1 },
  ];

  var PASSAGES = [
    "Correction is pitch-only now — up and down. No yaw, no roll. Left/right cycles UP .25 through .85, then BAND, DROP, MIX, INV.",
    "BAND keeps the walk-frequency nod and lets slow look-down through. DROP uses vertical bounce from the accelerometer. MIX blends pitch and bounce.",
    "OFF is the control. If every UP recipe feels worse than OFF, try INV. Recenter, then walk the same sidewalk twice.",
  ];

  var screens = {};
  var currentScreen = "home";
  var cardEl = document.getElementById("card");
  var cardText = document.getElementById("card-text");
  var cardKicker = document.getElementById("card-kicker");
  var statusMode = document.getElementById("status-mode");
  var statusSrc = document.getElementById("status-src");
  var statusHz = document.getElementById("status-hz");
  var btnPreset = document.getElementById("btn-preset");

  var presetIndex = 3;
  var page = 0;

  var gotOrientation = false;
  var gotMotion = false;
  var gotGravity = false;
  var orientationListening = false;
  var motionListening = false;
  var zerosSet = false;
  var liveSeen = false;
  var pendingAlign = false;

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
  var lastEulerPitch = 0;

  var lookPitch = 0;
  var slowPitch = 0;
  var bobSmooth = 0;
  var euroPitch = null;
  var gx = 0;
  var gy = 0;
  var gz = 9.81;
  var accelVel = 0;
  var accelDisp = 0;
  var outY = 0;

  var orientHits = 0;
  var motionHits = 0;
  var orientHz = 0;
  var motionHz = 0;
  var hzStamp = 0;
  var sampleAlpha = [];
  var sampleBeta = [];
  var sampleGamma = [];
  var SAMPLE_MAX = 12;

  var rafId = 0;
  var lastTs = 0;
  var headRms = 0;
  var cardRms = 0;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
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

  function createEuro(minCutoff, beta) {
    return { minCutoff: minCutoff, beta: beta, dcutoff: 1, x: null, dx: 0 };
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

  function leakToward(prev, next, dt, tau) {
    var k = 1 - Math.exp(-dt / tau);
    return prev + (next - prev) * k;
  }

  function preset() {
    return PRESETS[presetIndex] || PRESETS[2];
  }

  function resetFilters() {
    euroPitch = createEuro(2.2, 0.12);
    lookPitch = 0;
    slowPitch = 0;
    bobSmooth = 0;
    gx = rawAx || 0;
    gy = rawAy || 0;
    gz = rawAz || 9.81;
    accelVel = 0;
    accelDisp = 0;
    outY = 0;
    lastEulerPitch = 0;
    headRms = 0;
    cardRms = 0;
  }

  function holdBobBaseline() {
    pendingAlign = true;
    lastEulerPitch = 0;
    accelVel = 0;
    accelDisp = 0;
    outY = 0;
    if (euroPitch) euroPitch.x = null;
  }

  function readSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var i;
      if (data.preset) {
        for (i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].id === data.preset) {
            presetIndex = i;
            return;
          }
        }
      }
    } catch (err) {}
  }

  function writeSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ preset: preset().id }));
    } catch (err) {}
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
    focusFirst(screens[screenId]);
  }

  function moveFocus(direction) {
    var container = screens[currentScreen];
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
    if (typeof api === "undefined" || api === null) return Promise.resolve(false);
    if (typeof api.requestPermission !== "function") return Promise.resolve(true);
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

  function imuLive() {
    return gotOrientation || gotGravity;
  }

  function recentMean(values, fallback) {
    if (!values.length) return fallback;
    return meanAngle(values.slice(Math.max(0, values.length - 6)));
  }

  function captureZero() {
    alpha0 = recentMean(sampleAlpha, rawAlpha);
    beta0 = recentMean(sampleBeta, rawBeta);
    gamma0 = recentMean(sampleGamma, rawGamma);
    gravPitch0 = gravPitch;
    gravRoll0 = gravRoll;
    zerosSet = true;
    resetFilters();
  }

  function rejectSpike(next, last) {
    return Math.abs(wrapDelta(next, last)) > SPIKE_DEG && last !== 0;
  }

  function livePitch() {
    var recipe = preset();
    var pitch;
    if (!gotOrientation && gotGravity) {
      pitch = recipe.pitchSign * (gravPitch - gravPitch0);
    } else {
      pitch = recipe.pitchSign * wrapDelta(rawBeta, beta0);
    }
    pitch += recipe.pitchSign * (rawPitchRate || 0) * recipe.predict;
    if (rejectSpike(pitch, lastEulerPitch)) pitch = lastEulerPitch;
    else lastEulerPitch = pitch;
    return pitch;
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

  function updateAccel(dt) {
    if (!gotGravity) return;
    gx = leakToward(gx, rawAx, dt, GRAV_TAU);
    gy = leakToward(gy, rawAy, dt, GRAV_TAU);
    gz = leakToward(gz, rawAz, dt, GRAV_TAU);
    var mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (mag < 1) return;
    var vert = ((rawAx - gx) * gx + (rawAy - gy) * gy + (rawAz - gz) * gz) / mag;
    var leak = Math.exp(-dt / ACCEL_LEAK);
    accelVel = accelVel * leak + vert * dt;
    accelDisp = accelDisp * leak + accelVel * dt;
  }

  function targetY() {
    var recipe = preset();
    var pitchBob = lookPitch - slowPitch;
    if (recipe.algo === "band" || recipe.smooth) pitchBob = bobSmooth;
    var y = 0;
    if (recipe.algo !== "off" && recipe.algo !== "accel") {
      y += pitchBob * PX_PER_DEG * recipe.pitchGain;
    }
    if (recipe.algo === "accel" || recipe.algo === "mix") {
      y += accelDisp * PX_PER_M * recipe.accelGain * recipe.pitchSign;
    }
    return clamp(y, -MAX_Y_PX, MAX_Y_PX);
  }

  function applyCard(pitchBob) {
    var recipe = preset();
    var y = recipe.algo === "off" ? 0 : targetY();
    var delta = y - outY;
    if (delta > SLEW_PX) outY += SLEW_PX;
    else if (delta < -SLEW_PX) outY -= SLEW_PX;
    else outY = y;
    if (cardEl) {
      cardEl.style.transform = "translateY(" + outY.toFixed(1) + "px)";
    }
    var headMag = Math.abs(pitchBob);
    var cardMag = Math.abs(pitchBob - outY / PX_PER_DEG);
    headRms = leakToward(headRms, headMag, 0.05, 0.25);
    cardRms = leakToward(cardRms, cardMag, 0.05, 0.25);
  }

  function paintStatus() {
    var recipe = preset();
    if (statusMode) statusMode.textContent = recipe.label + " " + (presetIndex + 1) + "/" + PRESETS.length;
    if (statusSrc) statusSrc.textContent = imuLive() ? "IMU" : "WAIT";
    if (statusHz) statusHz.textContent = "— Hz";
    if (btnPreset) btnPreset.textContent = "PRESET " + recipe.label;
    if (cardKicker) cardKicker.textContent = "PASSAGE " + (page + 1) + " / " + PASSAGES.length;
    if (cardText) cardText.textContent = PASSAGES[page];
  }

  function tick(now) {
    if (currentScreen !== "read") {
      rafId = 0;
      return;
    }
    if (!lastTs) lastTs = now;
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;
    refreshHz(now);

    if (imuLive() && !liveSeen) {
      liveSeen = true;
      captureZero();
    }

    var pitch = liveSeen ? livePitch() : 0;
    var recipe = preset();
    var tau = recipe.tau || 0.8;

    lookPitch = filterEuro(euroPitch, pitch, dt);
    if (pendingAlign) {
      pendingAlign = false;
      slowPitch = lookPitch;
      bobSmooth = 0;
    } else {
      slowPitch = leakToward(slowPitch, lookPitch, dt, tau);
    }
    var pitchBob = lookPitch - slowPitch;
    if (recipe.smooth) bobSmooth = leakToward(bobSmooth, pitchBob, dt, recipe.smooth);
    else bobSmooth = pitchBob;

    updateAccel(dt);
    applyCard(pitchBob);
    if (statusSrc) {
      statusSrc.textContent =
        (imuLive() ? "IMU" : "WAIT") +
        "  P " +
        headRms.toFixed(1) +
        "°  Y " +
        Math.abs(outY).toFixed(0) +
        "px";
    }
    if (statusHz) {
      var hz = Math.max(orientHz, motionHz);
      statusHz.textContent = hz ? hz + " Hz" : "— Hz";
    }
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) return;
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (cardEl) cardEl.style.transform = "none";
  }

  function beginRead() {
    requestSensors().then(function () {
      gotOrientation = false;
      gotMotion = false;
      gotGravity = false;
      sampleAlpha = [];
      sampleBeta = [];
      sampleGamma = [];
      orientHits = 0;
      motionHits = 0;
      orientHz = 0;
      motionHz = 0;
      hzStamp = 0;
      zerosSet = false;
      liveSeen = false;
      pendingAlign = false;
      resetFilters();
      startSensors();
      paintStatus();
      navigateTo("read");
      startLoop();
    });
  }

  function leaveRead() {
    stopLoop();
    stopSensors();
    navigateTo("home");
  }

  function cyclePreset(dir) {
    presetIndex = (presetIndex + dir + PRESETS.length) % PRESETS.length;
    holdBobBaseline();
    writeSettings();
    paintStatus();
  }

  function nextPage() {
    page = (page + 1) % PASSAGES.length;
    paintStatus();
  }

  function handleAction(action) {
    switch (action) {
      case "home":
        if (currentScreen === "read") leaveRead();
        else navigateTo("home");
        break;
      case "how":
        navigateTo("how");
        break;
      case "read":
        beginRead();
        break;
      case "preset":
        cyclePreset(1);
        break;
      case "recenter":
        captureZero();
        break;
      case "page":
        nextPage();
        break;
      default:
        break;
    }
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "read") {
      if (event.key === DPAD.LEFT || event.key === DPAD.RIGHT) {
        event.preventDefault();
        cyclePreset(event.key === DPAD.RIGHT ? 1 : -1);
        return;
      }
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
    if (document.hidden && currentScreen === "read") leaveRead();
  });

  window.addEventListener("pagehide", function () {
    stopLoop();
    stopSensors();
  });

  readSettings();
  collectScreens();
  document.querySelectorAll(".build").forEach(function (el) {
    el.textContent = el.classList.contains("header-build") ? BUILD : "BUILD " + BUILD;
  });
  paintStatus();
  navigateTo("home");
})();
