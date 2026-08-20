(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var BUILD = "v2";
  var SETTINGS_KEY = "still-settings";
  var MODES = ["BOB", "WORLD", "OFF"];
  var PX_PER_DEG = 14;
  var YAW_SIGN = 1;
  var PITCH_SIGN = 1;
  var ROLL_SIGN = 1;
  var SPIKE_DEG = 50;
  var BOB_TAU = 0.7;
  var PREDICT_S = 0.04;
  var MAX_BOB_PX = 90;
  var MAX_WORLD_PX = 140;
  var GAIN_MIN = 0.25;
  var GAIN_MAX = 2;
  var GAIN_STEP = 0.25;

  var PASSAGES = [
    "The display rides on your skull. Each step bobs it a few degrees against the world your eyes already stabilize. Still tries to slide the paragraph the other way.",
    "BOB is a high-pass. Slow turns keep the card in front of you. Fast bounce — walking, nodding, a bumpy sidewalk — gets cancelled. WORLD pins the card to the heading you recentered on.",
    "Walk with BOB on, then switch to OFF on the same sidewalk. If the card fights you, drop GAIN or recenter after you settle.",
  ];

  var screens = {};
  var currentScreen = "home";
  var cardEl = document.getElementById("card");
  var cardText = document.getElementById("card-text");
  var cardKicker = document.getElementById("card-kicker");
  var statusMode = document.getElementById("status-mode");
  var statusSrc = document.getElementById("status-src");
  var statusHz = document.getElementById("status-hz");
  var btnMode = document.getElementById("btn-mode");
  var btnGain = document.getElementById("btn-gain");

  var mode = "BOB";
  var gain = 1;
  var page = 0;

  var gotOrientation = false;
  var gotMotion = false;
  var gotGravity = false;
  var orientationListening = false;
  var motionListening = false;
  var zerosSet = false;
  var liveSeen = false;

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

  var lookYaw = 0;
  var lookPitch = 0;
  var lookRoll = 0;
  var slowYaw = 0;
  var slowPitch = 0;
  var slowRoll = 0;
  var euroYaw = null;
  var euroPitch = null;
  var euroRoll = null;

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

  function resetFilters() {
    euroYaw = createEuro(3.2, 0.18);
    euroPitch = createEuro(3.2, 0.18);
    euroRoll = createEuro(3.2, 0.18);
    lookYaw = 0;
    lookPitch = 0;
    lookRoll = 0;
    slowYaw = 0;
    slowPitch = 0;
    slowRoll = 0;
    lastEulerYaw = 0;
    lastEulerPitch = 0;
    lastEulerRoll = 0;
    headRms = 0;
    cardRms = 0;
  }

  function readSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (MODES.indexOf(data.mode) !== -1) mode = data.mode;
      if (typeof data.gain === "number") gain = clamp(data.gain, GAIN_MIN, GAIN_MAX);
    } catch (err) {}
  }

  function writeSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: mode, gain: gain }));
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

  function livePose() {
    var yaw;
    var pitch;
    var roll;
    if (!gotOrientation && gotGravity) {
      yaw = gravRoll - gravRoll0;
      pitch = PITCH_SIGN * (gravPitch - gravPitch0);
      roll = ROLL_SIGN * wrapDelta(gravRoll, gravRoll0);
    } else {
      yaw = YAW_SIGN * wrapDelta(rawAlpha, alpha0);
      pitch = PITCH_SIGN * wrapDelta(rawBeta, beta0);
      roll = ROLL_SIGN * (gotGravity ? wrapDelta(gravRoll, gravRoll0) : wrapDelta(rawGamma, gamma0));
    }
    yaw += (rawYawRate || 0) * PREDICT_S;
    pitch += (rawPitchRate || 0) * PREDICT_S;
    roll += (rawRollRate || 0) * PREDICT_S;
    if (rejectSpike(yaw, lastEulerYaw)) yaw = lastEulerYaw;
    else lastEulerYaw = yaw;
    if (rejectSpike(pitch, lastEulerPitch)) pitch = lastEulerPitch;
    else lastEulerPitch = pitch;
    if (rejectSpike(roll, lastEulerRoll)) roll = lastEulerRoll;
    else lastEulerRoll = roll;
    return { yaw: yaw, pitch: pitch, roll: roll };
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

  function usedPose() {
    if (mode === "OFF") return { yaw: 0, pitch: 0, roll: 0 };
    if (mode === "WORLD") return { yaw: lookYaw, pitch: lookPitch, roll: lookRoll };
    return {
      yaw: lookYaw - slowYaw,
      pitch: lookPitch - slowPitch,
      roll: lookRoll - slowRoll,
    };
  }

  function applyCard(head, used) {
    var maxPx = mode === "WORLD" ? MAX_WORLD_PX : MAX_BOB_PX;
    var x = clamp(-used.yaw * PX_PER_DEG * gain, -maxPx, maxPx);
    var y = clamp(used.pitch * PX_PER_DEG * gain, -maxPx, maxPx);
    var r = clamp(-used.roll * gain, -12, 12);
    if (cardEl) {
      cardEl.style.transform =
        "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px) rotate(" + r.toFixed(2) + "deg)";
    }
    var headMag = Math.sqrt(head.yaw * head.yaw + head.pitch * head.pitch);
    var residualYaw = head.yaw - used.yaw * gain;
    var residualPitch = head.pitch - used.pitch * gain;
    var cardMag = Math.sqrt(residualYaw * residualYaw + residualPitch * residualPitch);
    headRms = leakToward(headRms, headMag, 0.05, 0.25);
    cardRms = leakToward(cardRms, cardMag, 0.05, 0.25);
  }

  function paintStatus() {
    if (statusMode) statusMode.textContent = mode;
    if (statusSrc) statusSrc.textContent = imuLive() ? "IMU" : "WAIT";
    if (statusHz) statusHz.textContent = "— Hz";
    if (btnMode) btnMode.textContent = "MODE " + mode;
    if (btnGain) btnGain.textContent = "GAIN " + gain.toFixed(2);
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

    var head = liveSeen ? livePose() : { yaw: 0, pitch: 0, roll: 0 };

    lookYaw = filterEuro(euroYaw, head.yaw, dt);
    lookPitch = filterEuro(euroPitch, head.pitch, dt);
    lookRoll = filterEuro(euroRoll, head.roll, dt);
    slowYaw = leakToward(slowYaw, lookYaw, dt, BOB_TAU);
    slowPitch = leakToward(slowPitch, lookPitch, dt, BOB_TAU);
    slowRoll = leakToward(slowRoll, lookRoll, dt, BOB_TAU);

    applyCard({ yaw: lookYaw, pitch: lookPitch, roll: lookRoll }, usedPose());
    if (statusSrc) {
      statusSrc.textContent =
        (imuLive() ? "IMU" : "WAIT") +
        "  H " +
        headRms.toFixed(1) +
        "°  C " +
        cardRms.toFixed(1) +
        "°";
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

  function cycleMode(dir) {
    var idx = MODES.indexOf(mode);
    idx = (idx + dir + MODES.length) % MODES.length;
    mode = MODES[idx];
    writeSettings();
    paintStatus();
  }

  function nudgeGain(dir) {
    gain = clamp(Math.round((gain + dir * GAIN_STEP) * 100) / 100, GAIN_MIN, GAIN_MAX);
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
      case "mode":
        cycleMode(1);
        break;
      case "gain":
        nudgeGain(1);
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

  function activeAction() {
    var el = document.activeElement;
    return el && el.getAttribute ? el.getAttribute("data-action") : "";
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "read") {
      var action = activeAction();
      if (event.key === DPAD.LEFT || event.key === DPAD.RIGHT) {
        var dir = event.key === DPAD.RIGHT ? 1 : -1;
        if (action === "mode") {
          event.preventDefault();
          cycleMode(dir);
          return;
        }
        if (action === "gain") {
          event.preventDefault();
          nudgeGain(dir);
          return;
        }
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
