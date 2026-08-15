(function () {
  "use strict";

  var MAX_ROWS = 40;
  var POLL_MS = 20000;
  var STORAGE = {
    seen: "situation_v2_seen_ids",
    lines: "situation_v2_last_lines",
    updated: "situation_v2_updated_at",
  };

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
    BACK: "Escape",
  };

  var SWIPE_PX = 56;
  var clockEls = document.querySelectorAll(".clock");
  var updatedEl = document.getElementById("updated");
  var terminalEl = document.getElementById("terminal");
  var detailPosEl = document.getElementById("detail-pos");
  var detailCardEl = document.getElementById("detail-card");
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
    signalError: false,
    updatedAt: null,
    visible: [],
    seen: {},
    detailIndex: -1,
  };

  var swipe = {
    active: false,
    x: 0,
    y: 0,
    scroll: 0,
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

  function categoryTag(item) {
    var cat = String(item.category || "world").toUpperCase();
    return cat.slice(0, 10);
  }

  function severityLevel(item) {
    var n = Number(item.severity);
    if (!n || n < 1) return 0;
    if (n > 4) return 4;
    return n;
  }

  function severityClass(item) {
    var n = severityLevel(item);
    return n ? "sev-" + n : "";
  }

  function mtsOnly(items) {
    return items.filter(function (item) {
      return String(item.source || "").toUpperCase() === "MTS";
    });
  }

  function newestFirst(items) {
    return items.slice().sort(function (a, b) {
      return parseTs(b.ts).getTime() - parseTs(a.ts).getTime();
    });
  }

  function newestStamp(items) {
    if (!items.length) return null;
    return parseTs(newestFirst(items)[0].ts);
  }

  function fillMeta(container, item) {
    container.textContent = "";
    var time = document.createElement("span");
    time.textContent = hhmm(item.ts);
    container.appendChild(time);
    var level = severityLevel(item);
    if (level) {
      var badge = document.createElement("span");
      badge.className = "sev-badge " + severityClass(item);
      badge.textContent = "S" + level;
      container.appendChild(badge);
    }
    var rest = document.createElement("span");
    rest.textContent = [categoryTag(item), item.source, item.location]
      .filter(Boolean)
      .join("  ");
    container.appendChild(rest);
  }

  function renderRows(opts) {
    opts = opts || {};
    var keepId =
      document.activeElement && document.activeElement.getAttribute
        ? document.activeElement.getAttribute("data-id")
        : null;
    var scroll = terminalEl.scrollTop;

    terminalEl.innerHTML = "";
    state.visible.forEach(function (item) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = ("row focusable " + severityClass(item)).trim();
      row.setAttribute("data-id", item.id);
      row.setAttribute("data-action", "open");
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

    terminalEl.scrollTop = opts.stickToTop ? 0 : scroll;
    if (keepId && currentScreen === "home") {
      var keepEl = terminalEl.querySelector('[data-id="' + keepId + '"]');
      if (keepEl) keepEl.focus();
    }
  }

  function persist() {
    saveJson(STORAGE.lines, state.visible);
    saveJson(STORAGE.seen, Object.keys(state.seen).slice(-500));
    if (state.updatedAt) {
      localStorage.setItem(STORAGE.updated, state.updatedAt.toISOString());
    }
  }

  function formatUpdated(date) {
    var mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    var when = timeFmt.format(date);
    if (mins < 1) return "Updated " + when + " · just now";
    if (mins < 60) return "Updated " + when + " · " + mins + "m ago";
    var hours = Math.floor(mins / 60);
    if (hours < 24) return "Updated " + when + " · " + hours + "h ago";
    return "Updated " + when;
  }

  function updateChrome() {
    var now = formatClock(new Date());
    clockEls.forEach(function (el) {
      el.textContent = now;
    });
    updatedEl.classList.remove("is-error");
    if (state.signalError) {
      updatedEl.textContent = "NO SIGNAL";
      updatedEl.classList.add("is-error");
      return;
    }
    if (state.updatedAt) {
      updatedEl.textContent = formatUpdated(state.updatedAt);
      return;
    }
    updatedEl.textContent = "Updated --";
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

  function applyList(items, opts) {
    opts = opts || {};
    state.visible = newestFirst(items).slice(0, MAX_ROWS);
    state.updatedAt = newestStamp(state.visible);
    rememberAll(items);
    renderRows({ stickToTop: !!opts.stickToTop });
    persist();
    updateChrome();
    if (opts.focusHome && currentScreen === "home") focusFirst(screens.home);
  }

  function ingest(feed) {
    var items = mtsOnly(Array.isArray(feed && feed.items) ? feed.items : []);
    state.signalError = items.length === 0;
    if (!items.length) {
      persist();
      updateChrome();
      return;
    }
    applyList(items, {
      stickToTop: !state.visible.length,
      focusHome: !state.visible.length,
    });
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
        updateChrome();
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
    var lines = mtsOnly(loadJson(STORAGE.lines, []));
    if (lines.length) {
      state.visible = newestFirst(lines).slice(0, MAX_ROWS);
      state.updatedAt = newestStamp(state.visible);
      renderRows({ stickToTop: true });
    }
    updateChrome();
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

  function findItemIndex(id) {
    var i;
    for (i = 0; i < state.visible.length; i++) {
      if (state.visible[i].id === id) return i;
    }
    return -1;
  }

  function renderDetail(item) {
    if (!item) return;
    state.detailIndex = findItemIndex(item.id);
    fillMeta(detailMetaEl, item);
    detailHeadlineEl.textContent = item.headline || "";
    detailSummaryEl.textContent =
      item.summary || "No additional detail in this feed item.";
    detailCardEl.className = ("detail-card " + severityClass(item)).trim();
    detailPosEl.textContent =
      state.detailIndex >= 0
        ? state.detailIndex + 1 + " / " + state.visible.length
        : "1 / 1";
    detailCardEl.scrollTop = 0;
    updateChrome();
  }

  function focusDetailBack() {
    if (detailBackEl) detailBackEl.focus();
  }

  function openFocusedRow() {
    if (currentScreen !== "home") return;
    var el = document.activeElement;
    if (!el || !terminalEl.contains(el)) return;
    var id = el.getAttribute("data-id");
    if (!id) return;
    openDetail(findItem(id));
  }

  function openDetail(item) {
    if (!item) return;
    renderDetail(item);
    navigateTo("detail");
    focusDetailBack();
  }

  function showAdjacent(delta) {
    if (currentScreen !== "detail" || !state.visible.length) return;
    var idx = state.detailIndex;
    if (idx < 0) idx = 0;
    var next = (idx + delta + state.visible.length) % state.visible.length;
    renderDetail(state.visible[next]);
    focusDetailBack();
  }

  function goHome() {
    var id =
      state.detailIndex >= 0 && state.visible[state.detailIndex]
        ? state.visible[state.detailIndex].id
        : null;
    navigateTo("home");
    if (!id) return;
    var row = terminalEl.querySelector('[data-id="' + id + '"]');
    if (row) row.focus();
  }

  function isBackKey(key) {
    return key === DPAD.BACK || key === "Backspace";
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

  detailBackEl.addEventListener("click", function () {
    goHome();
  });

  terminalEl.addEventListener("pointerdown", function (event) {
    var row = event.target.closest("[data-id]");
    if (!row) return;
    if (event.pointerType === "mouse") {
      row.focus();
      return;
    }
    event.preventDefault();
  });

  terminalEl.addEventListener("click", function () {
    openFocusedRow();
  });

  detailCardEl.addEventListener("pointerdown", function (event) {
    swipe.active = true;
    swipe.x = event.clientX;
    swipe.y = event.clientY;
    swipe.scroll = detailCardEl.scrollTop;
    if (detailCardEl.setPointerCapture) {
      detailCardEl.setPointerCapture(event.pointerId);
    }
  });

  detailCardEl.addEventListener("pointermove", function (event) {
    if (!swipe.active) return;
    var dy = event.clientY - swipe.y;
    var dx = event.clientX - swipe.x;
    if (Math.abs(dy) >= Math.abs(dx)) {
      detailCardEl.scrollTop = swipe.scroll - dy;
    }
  });

  function endSwipe(event) {
    if (!swipe.active) return;
    swipe.active = false;
    var dx = event.clientX - swipe.x;
    var dy = event.clientY - swipe.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
    showAdjacent(dx < 0 ? 1 : -1);
  }

  detailCardEl.addEventListener("pointerup", endSwipe);
  detailCardEl.addEventListener("pointercancel", endSwipe);

  document.addEventListener("keydown", function (event) {
    if (isBackKey(event.key) && currentScreen === "detail") {
      goHome();
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case DPAD.UP:
        if (currentScreen === "detail") {
          showAdjacent(-1);
        } else {
          moveFocus("up");
        }
        break;
      case DPAD.DOWN:
        if (currentScreen === "detail") {
          showAdjacent(1);
        } else {
          moveFocus("down");
        }
        break;
      case DPAD.LEFT:
        if (currentScreen === "detail") {
          showAdjacent(-1);
        } else {
          moveFocus("left");
        }
        break;
      case DPAD.RIGHT:
        if (currentScreen === "detail") {
          showAdjacent(1);
        } else {
          moveFocus("right");
        }
        break;
      case DPAD.SELECT:
        if (currentScreen === "detail") {
          goHome();
          break;
        }
        openFocusedRow();
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  collectScreens();
  restore();
  focusFirst(screens.home);
  fetchFeed();
  setInterval(fetchFeed, POLL_MS);
  setInterval(updateChrome, 1000);
})();
