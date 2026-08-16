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
    { name: "Cadence", href: "apps/cadence/" },
    { name: "Gyre", href: "apps/gyre/" },
    { name: "Stack", href: "apps/stack/" },
    { name: "Well", href: "apps/well/" },
    { name: "Merge", href: "apps/merge/" },
    { name: "Putt", href: "apps/putt/" },
    { name: "Situation", href: "apps/situation/" },
    { name: "Markets", href: "apps/markets/" },
    { name: "Lock On", href: "apps/lockon/" },
    { name: "Strike", href: "apps/strike/" },
    { name: "Starter", href: "apps/starter/" },
    { name: "IO Probe", href: "apps/ioprobe/" },
  ];

  function renderApps() {
    var list = document.getElementById("app-list");
    APPS.forEach(function (app) {
      var button = document.createElement("button");
      button.className = "focusable";
      button.setAttribute("data-href", app.href);
      button.textContent = app.name;
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

