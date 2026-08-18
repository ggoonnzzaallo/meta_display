(function () {
  "use strict";

  var DPAD = {
    UP: "ArrowUp",
    DOWN: "ArrowDown",
    LEFT: "ArrowLeft",
    RIGHT: "ArrowRight",
    SELECT: "Enter",
  };

  var APPS = [
    { name: "Cadence", href: "apps/cadence/", version: "v8", updated: "2026-08-18T00:00:00Z", blurb: "Swipe matching arrows on the beat" },
    { name: "Apex", href: "apps/apex/", version: "v2", updated: "2026-08-17T23:58:53Z", blurb: "F1 lights out, then drive until you box" },
    { name: "Gyre", href: "apps/gyre/", version: "v9", updated: "2026-08-18T15:28:00Z", blurb: "Thin lines. Hold the cream face until they cross" },
    { name: "Stack", href: "apps/stack/", version: "v4", updated: "2026-08-17T19:51:41Z", blurb: "Pinch to drop and keep the width" },
    { name: "Well", href: "apps/well/", version: "v5", updated: "2026-08-17T20:41:31Z", blurb: "Tiny Tetris. Pinch hard-drops" },
    { name: "Merge", href: "apps/merge/", version: "v3", updated: "2026-08-18T15:15:00Z", blurb: "6×6 2048. Empty space fills faster" },
    { name: "Putt", href: "apps/putt/", version: "v2", updated: "2026-08-17T19:51:41Z", blurb: "Card golf. Land on the cup" },
    { name: "Trio", href: "apps/trio/", version: "v1", updated: "2026-08-16T17:53:18Z", blurb: "Threes-style slider. One step per swipe" },
    { name: "Court", href: "apps/court/", version: "v2", updated: "2026-08-17T19:51:41Z", blurb: "Left or right decrees. Keep four meters" },
    { name: "Skim", href: "apps/skim/", version: "v3", updated: "2026-08-17T20:42:40Z", blurb: "Canyon racer. Tap altitude, pinch boost" },
    { name: "Situation", href: "apps/situation/", version: "v1", updated: "2026-08-15T01:54:23Z", blurb: "Live headlines from Monitor the Situation" },
    { name: "Markets", href: "apps/markets/", version: "v1", updated: "2026-08-15T01:54:23Z", blurb: "Movers, earnings, and market headlines" },
    { name: "Lock On", href: "apps/lockon/", version: "v30", updated: "2026-08-15T18:51:30Z", blurb: "Head-aim HUD. Bring targets to the pipper" },
    { name: "Strike", href: "apps/strike/", version: "v1", updated: "2026-08-15T02:44:47Z", blurb: "Head-aim shooting gallery" },
    { name: "Starter", href: "apps/starter/", version: "v1", updated: "2026-08-15T01:30:13Z", blurb: "Smoke-test the glasses Web App shell" },
    { name: "IO Probe", href: "apps/ioprobe/", version: "v1", updated: "2026-08-15T05:42:11Z", blurb: "Camera, mic, and location permission check" },
  ];

  function formatPacific(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(d);
    var map = {};
    parts.forEach(function (part) {
      map[part.type] = part.value;
    });
    return (
      map.month +
      " " +
      map.day +
      ", " +
      map.year +
      " " +
      map.hour +
      ":" +
      map.minute +
      " " +
      map.dayPeriod +
      " PT"
    );
  }

  function pacificDay(iso) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  }

  function latestUpdateDay() {
    var latest = "";
    APPS.forEach(function (app) {
      if (!app.updated) return;
      var day = pacificDay(app.updated);
      if (day > latest) latest = day;
    });
    return latest;
  }

  function isNew(app, latestDay) {
    return !!(app.updated && latestDay && pacificDay(app.updated) === latestDay);
  }

  function renderApps() {
    var list = document.getElementById("app-list");
    var latestDay = latestUpdateDay();
    APPS.forEach(function (app) {
      var button = document.createElement("button");
      button.className = "focusable";
      button.setAttribute("data-href", app.href);
      var nameRow = document.createElement("span");
      nameRow.className = "app-name-row";
      var name = document.createElement("span");
      name.className = "app-name";
      name.textContent = app.name;
      nameRow.appendChild(name);
      if (isNew(app, latestDay)) {
        var badge = document.createElement("span");
        badge.className = "app-new";
        badge.textContent = "*NEW*";
        nameRow.appendChild(badge);
      }
      var blurb = document.createElement("span");
      blurb.className = "app-blurb";
      blurb.textContent = (app.version ? app.version + " · " : "") + (app.blurb || "");
      button.appendChild(nameRow);
      button.appendChild(blurb);
      if (app.updated) {
        var when = document.createElement("span");
        when.className = "app-updated";
        when.textContent = "Last updated on " + formatPacific(app.updated);
        button.appendChild(when);
      }
      list.appendChild(button);
    });
  }

  function moveFocus(direction) {
    var focusables = Array.from(
      document.querySelectorAll(".focusable:not([disabled]):not(.hidden)")
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

  function openFocused() {
    var el = document.activeElement;
    if (!el || !el.classList.contains("focusable")) return;
    var href = el.getAttribute("data-href");
    if (href) window.location.href = href;
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
        openFocused();
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-href]");
    if (!target) return;
    window.location.href = target.getAttribute("data-href");
  });

  function formatClock(date) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(date);
  }

  function updateClock() {
    var clockEl = document.getElementById("clock");
    if (clockEl) clockEl.textContent = formatClock(new Date());
  }

  renderApps();
  updateClock();
  setInterval(updateClock, 1000);
  var first = document.querySelector(".focusable");
  if (first) first.focus();
})();
