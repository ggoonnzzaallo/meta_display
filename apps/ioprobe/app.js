(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var GEO_ERRORS = {
    1: "PERMISSION_DENIED",
    2: "POSITION_UNAVAILABLE",
    3: "TIMEOUT",
  };

  var screens = {};
  var currentScreen = "home";
  var activeStream = null;
  var clockEls = document.querySelectorAll(".clock");
  var clockFmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  function updateClock() {
    var now = clockFmt.format(new Date());
    clockEls.forEach(function (el) {
      el.textContent = now;
    });
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

  function setStatus(id, text, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = "probe-status" + (kind ? " " + kind : "");
  }

  function setResult(text) {
    var el = document.getElementById("result-text");
    if (el) el.textContent = text;
  }

  function stopStream() {
    if (activeStream) {
      activeStream.getTracks().forEach(function (track) {
        track.stop();
      });
      activeStream = null;
    }
    var video = document.getElementById("preview");
    if (video) {
      video.srcObject = null;
      video.classList.add("hidden");
    }
  }

  function hasGetUserMedia() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function queryPermission(name) {
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve("no Permissions API");
    }
    return navigator.permissions
      .query({ name: name })
      .then(function (status) {
        return status.state;
      })
      .catch(function () {
        return "query unsupported";
      });
  }

  function listDevices(kind) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve("enumerateDevices missing");
    }
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var matches = devices.filter(function (device) {
        return device.kind === kind;
      });
      if (!matches.length) return "0 " + kind;
      return matches
        .map(function (device, index) {
          return (device.label || "unnamed") + " #" + (index + 1);
        })
        .join("; ");
    });
  }

  function describeTrack(track) {
    var settings = {};
    try {
      settings = track.getSettings ? track.getSettings() : {};
    } catch (err) {
      settings = {};
    }
    var bits = [track.kind, track.readyState, track.label || "no label"];
    if (settings.width && settings.height) {
      bits.push(settings.width + "x" + settings.height);
    }
    if (settings.sampleRate) bits.push(settings.sampleRate + " Hz");
    if (settings.deviceId) bits.push("id " + String(settings.deviceId).slice(0, 8));
    return bits.join(" · ");
  }

  function showPreview(stream) {
    var video = document.getElementById("preview");
    if (!video || !stream.getVideoTracks().length) return;
    video.srcObject = stream;
    video.classList.remove("hidden");
    var play = video.play();
    if (play && play.catch) play.catch(function () {});
  }

  function testGetUserMedia(kind, constraints, statusId, label) {
    stopStream();
    setStatus(statusId, "asking…", "wait");
    setResult("Requesting " + label + "… watch for a permission prompt.");

    if (!window.isSecureContext) {
      setStatus(statusId, "blocked", "fail");
      setResult(label + ": insecure context. Glasses need HTTPS.");
      return;
    }
    if (!hasGetUserMedia()) {
      setStatus(statusId, "no API", "fail");
      setResult(label + ": navigator.mediaDevices.getUserMedia is missing.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(function (stream) {
        activeStream = stream;
        var tracks = stream.getTracks();
        var detail = tracks.map(describeTrack).join(" | ") || "stream opened, no tracks";
        return listDevices(kind).then(function (devices) {
          setStatus(statusId, "ok", "ok");
          setResult(label + " granted. " + detail + ". Devices: " + devices);
          showPreview(stream);
        });
      })
      .catch(function (err) {
        setStatus(statusId, err.name || "error", "fail");
        setResult(label + " failed: " + (err.name || "Error") + " — " + (err.message || "no message"));
      });
  }

  function testLocation() {
    stopStream();
    setStatus("status-location", "asking…", "wait");
    setResult("Requesting location from the paired phone…");

    if (!navigator.geolocation) {
      setStatus("status-location", "no API", "fail");
      setResult("Location: navigator.geolocation is missing.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (position) {
        var coords = position.coords;
        var parts = [
          coords.latitude.toFixed(5) + ", " + coords.longitude.toFixed(5),
          "±" + Math.round(coords.accuracy) + " m",
        ];
        if (coords.altitude != null) parts.push("alt " + Math.round(coords.altitude) + " m");
        if (coords.speed != null) parts.push(coords.speed.toFixed(1) + " m/s");
        setStatus("status-location", "ok", "ok");
        setResult("Location granted. " + parts.join(" · "));
      },
      function (error) {
        var code = GEO_ERRORS[error.code] || "code " + error.code;
        setStatus("status-location", code, "fail");
        setResult("Location failed: " + code + " — " + (error.message || "no message"));
      },
      { timeout: 15000, maximumAge: 0 }
    );
  }

  function handleAction(action) {
    if (action === "test-camera") {
      testGetUserMedia("videoinput", { video: true, audio: false }, "status-camera", "Camera");
      return;
    }
    if (action === "test-mic") {
      testGetUserMedia("audioinput", { video: false, audio: true }, "status-mic", "Microphone");
      return;
    }
    if (action === "test-location") {
      testLocation();
    }
  }

  function renderEnv() {
    var parts = [
      window.isSecureContext ? "HTTPS" : "not secure",
      hasGetUserMedia() ? "getUserMedia" : "no getUserMedia",
      navigator.geolocation ? "geolocation" : "no geolocation",
    ];
    Promise.all([
      queryPermission("camera"),
      queryPermission("microphone"),
      queryPermission("geolocation"),
    ]).then(function (states) {
      parts.push("perm cam " + states[0]);
      parts.push("mic " + states[1]);
      parts.push("geo " + states[2]);
      var el = document.getElementById("env-line");
      if (el) el.textContent = parts.join(" · ");
    });
  }

  document.addEventListener("keydown", function (event) {
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
    if (document.hidden) stopStream();
  });

  window.addEventListener("pagehide", stopStream);

  collectScreens();
  updateClock();
  setInterval(updateClock, 1000);
  renderEnv();
  navigateTo("home");
})();
