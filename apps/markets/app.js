(function () {
  "use strict";

  var MAX_ROWS = 40;
  var TICK_MS = 1200;
  var POLL_MS = 20000;
  var STORAGE = {
    seen: "markets_seen_ids",
    paused: "markets_paused",
    lines: "markets_last_lines",
  };

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var KIND_LABEL = {
    idx: "IDX",
    up: "UP",
    down: "DN",
    vol: "VOL",
    news: "NEWS",
    earn: "ERN",
  };

  var statusEl = document.getElementById("status");
  var clockEl = document.getElementById("clock");
  var terminalEl = document.getElementById("terminal");
  var toggleEl = document.getElementById("toggle");
  var detailMetaEl = document.getElementById("detail-meta");
  var detailHeadlineEl = document.getElementById("detail-headline");
  var detailSummaryEl = document.getElementById("detail-summary");
  var detailBackEl = document.getElementById("detail-back");

  var screens = {};
  var currentScreen = "home";
  var clockFmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  var timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  var state = {
    paused: false,
    signalError: false,
    visible: [],
    queue: [],
    seen: {},
  };

  function collectScreens() {
    document.querySelectorAll(".screen").forEach(function (screen) {
      if (screen.id) screens[screen.id] = screen;
    });
  }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* quota */
    }
  }

  function formatClock(date) {
    return clockFmt.format(date);
  }

  function parseTs(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  function hhmm(iso) {
    return timeFmt.format(parseTs(iso));
  }

  function kindOf(item) {
    return item.kind || "news";
  }

  function fillMeta(container, item) {
    container.textContent = "";
    var time = document.createElement("span");
    time.textContent = hhmm(item.ts);
    container.appendChild(time);
    var badge = document.createElement("span");
    var kind = kindOf(item);
    badge.className = "kind-badge " + kind;
    badge.textContent = KIND_LABEL[kind] || kind.toUpperCase();
    container.appendChild(badge);
    var rest = document.createElement("span");
    rest.textContent = [item.symbol, item.source].filter(Boolean).join("  ");
    container.appendChild(rest);
  }

  function isNearBottom() {
    var remaining =
      terminalEl.scrollHeight - terminalEl.scrollTop - terminalEl.clientHeight;
    return remaining < 48;
  }

  function renderRows(opts) {
    opts = opts || {};
    var keepId =
      document.activeElement && document.activeElement.getAttribute
        ? document.activeElement.getAttribute("data-id")
        : null;
    var pinBottom = opts.stickToBottom || isNearBottom();
    var pinTop = opts.stickToTop;

    terminalEl.innerHTML = "";
    state.visible.forEach(function (item) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = ("row focusable " + kindOf(item)).trim();
      row.setAttribute("data-id", item.id);
      var meta = document.createElement("div");
      meta.className = "row-meta";
      fillMeta(meta, item);
      var headline = document.createElement("div");
      headline.className = "row-headline";
      headline.textContent = item.headline || "";
      row.appendChild(meta);
      row.appendChild(headline);
      terminalEl.appendChild(row);
    });

    if (pinTop) {
      terminalEl.scrollTop = 0;
    } else if (pinBottom) {
      terminalEl.scrollTop = terminalEl.scrollHeight;
    }
    if (keepId && currentScreen === "home") {
      var keepEl = terminalEl.querySelector('[data-id="' + keepId + '"]');
      if (keepEl) keepEl.focus();
    }
  }

  function persist() {
    saveJson(STORAGE.lines, state.visible);
    saveJson(STORAGE.seen, Object.keys(state.seen).slice(-500));
    localStorage.setItem(STORAGE.paused, state.paused ? "1" : "0");
  }

  function setPaused(paused) {
    state.paused = paused;
    toggleEl.textContent = paused ? "Resume" : "Pause";
    updateStatus();
    persist();
  }

  function updateStatus() {
    statusEl.classList.remove("is-paused", "is-error");
    if (state.signalError) {
      statusEl.textContent = "NO SIGNAL";
      statusEl.classList.add("is-error");
      return;
    }
    if (state.paused) {
      statusEl.textContent = "PAUSED";
      statusEl.classList.add("is-paused");
      return;
    }
    statusEl.textContent = "LIVE";
  }

  function markSeen(id) {
    if (!id) return;
    state.seen[id] = true;
  }

  function rememberAll(items) {
    items.forEach(function (item) {
      markSeen(item.id);
    });
  }

  function applyFirstPaint(items) {
    state.visible = items.slice(0, MAX_ROWS);
    rememberAll(items);
    renderRows({ stickToTop: true });
    persist();
  }

  function enqueueNew(items) {
    items.forEach(function (item) {
      if (!item.id || state.seen[item.id]) return;
      state.queue.push(item);
      markSeen(item.id);
    });
  }

  function tick() {
    if (currentScreen !== "home") return;
    if (state.paused || !state.queue.length) return;
    var next = state.queue.shift();
    state.visible.push(next);
    if (state.visible.length > MAX_ROWS) {
      state.visible.shift();
    }
    renderRows({ stickToBottom: isNearBottom() });
    persist();
  }

  function ingest(feed) {
    var items = Array.isArray(feed && feed.items) ? feed.items : [];
    state.signalError = items.length === 0;
    updateStatus();
    if (!items.length) return;
    if (!state.visible.length || state.visible.length < 8) {
      applyFirstPaint(items);
      return;
    }
    enqueueNew(items);
  }

  function fetchFeed() {
    return fetch("feed.json?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        ingest(data);
      })
      .catch(function () {
        state.signalError = true;
        updateStatus();
      });
  }

  function restore() {
    var seenList = loadJson(STORAGE.seen, []);
    var seen = {};
    if (Array.isArray(seenList)) {
      seenList.slice(-500).forEach(function (id) {
        seen[id] = true;
      });
    }
    state.seen = seen;
    var lines = loadJson(STORAGE.lines, []);
    if (Array.isArray(lines) && lines.length) {
      state.visible = lines.slice(0, MAX_ROWS);
      renderRows({ stickToTop: true });
    }
    setPaused(localStorage.getItem(STORAGE.paused) === "1");
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

  function findItem(id) {
    var i;
    for (i = 0; i < state.visible.length; i++) {
      if (state.visible[i].id === id) return state.visible[i];
    }
    return null;
  }

  function openDetail(item) {
    if (!item) return;
    fillMeta(detailMetaEl, item);
    detailHeadlineEl.textContent = item.headline || "";
    detailSummaryEl.textContent =
      item.summary || "No additional detail in this feed item.";
    navigateTo("detail");
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
    focusables[next].scrollIntoView({ block: "nearest" });
  }

  toggleEl.addEventListener("click", function () {
    setPaused(!state.paused);
  });

  detailBackEl.addEventListener("click", function () {
    navigateTo("home");
  });

  terminalEl.addEventListener("click", function (event) {
    var row = event.target.closest("[data-id]");
    if (!row) return;
    openDetail(findItem(row.getAttribute("data-id")));
  });

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

  collectScreens();
  restore();
  updateStatus();
  toggleEl.focus();
  fetchFeed();
  setInterval(tick, TICK_MS);
  setInterval(fetchFeed, POLL_MS);
  setInterval(function () {
    clockEl.textContent = formatClock(new Date());
  }, 1000);
  clockEl.textContent = formatClock(new Date());
})();
