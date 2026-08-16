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

  var SAVE_KEY = "putt-hole";
  var GREEN = "#12A35A";
  var FAIR = "#1C3D2A";
  var SAND = "#C4A35A";
  var WALL = "#5A5D62";
  var PIT = "#121417";
  var CREAM = "#FFFFFF";
  var CYAN = "#00D4FF";
  var SURFACE = "#1C1E21";
  var MUTED = "#B0B3B8";
  var DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  var LEVELS = [
    { cards: ["R2"], rows: [".....", "..H..", ".....", "..B..", "....."] },
    { cards: ["R1", "R2"], rows: [".....", ".H...", ".....", ".....", ".B..."] },
    { cards: ["R3", "R2"], rows: ["..#..", "..H..", ".....", "..B.."] },
    { cards: ["R3", "R2"], rows: ["B....", ".....", "...H."] },
    { cards: ["J3"], rows: [".....", "B.#H.", "....."] },
    { cards: ["R2", "J3"], rows: [".......", "B..#.H.", "......."] },
    { cards: ["R3", "J3"], rows: [".....", "B.SH.", "....."] },
    { cards: ["R3", "J2"], rows: [".......", "B..S.H.", "......."] },
    { cards: ["J3"], rows: [".....", "B.WH.", "....."] },
    { cards: ["R3", "R2"], rows: ["B...", ".WW.", ".W.H"] },
    { cards: ["R2", "R4"], rows: ["#H#", "...", ".B."] },
    { cards: ["J3", "R2"], rows: ["........", "B.W..H..", "........"] },
  ];

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var tray = document.getElementById("tray");
  var playBtn = document.getElementById("play-btn");
  var pauseOverlay = document.getElementById("pause-overlay");
  var holeOverlay = document.getElementById("hole-overlay");
  var holeTitle = document.getElementById("hole-title");
  var bestReadout = document.getElementById("best-readout");

  var running = false;
  var paused = false;
  var aiming = false;
  var animating = false;
  var holeIndex = 0;
  var grid = [];
  var cols = 0;
  var rows = 0;
  var ball = { x: 0, y: 0 };
  var start = { x: 0, y: 0 };
  var hole = { x: 0, y: 0 };
  var cards = [];
  var selected = -1;
  var history = [];
  var flash = "";
  var drawBall = { x: 0, y: 0, z: 0 };
  var rafId = 0;
  var lastTs = 0;

  function playKey(event) {
    var k = event.key;
    var c = event.keyCode;
    if (k === "ArrowUp" || k === "Up" || c === 38) return "up";
    if (k === "ArrowDown" || k === "Down" || c === 40) return "down";
    if (k === "ArrowLeft" || k === "Left" || c === 37) return "left";
    if (k === "ArrowRight" || k === "Right" || c === 39) return "right";
    if (k === "Enter" || c === 13) return "enter";
    if (k === "Escape" || c === 27) return "escape";
    return "";
  }

  function focusPlay() {
    if (playBtn) {
      playBtn.classList.add("live");
      playBtn.disabled = false;
      playBtn.focus();
    }
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

  function focusRoot() {
    if (currentScreen === "play" && paused) return pauseOverlay;
    if (currentScreen === "play" && holeOverlay && !holeOverlay.classList.contains("hidden")) {
      return holeOverlay;
    }
    if (currentScreen === "play" && !aiming) return tray;
    return screens[currentScreen];
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

  function readProgress() {
    try {
      return parseInt(localStorage.getItem(SAVE_KEY) || "0", 10) || 0;
    } catch (err) {
      return 0;
    }
  }

  function writeProgress(value) {
    try {
      localStorage.setItem(SAVE_KEY, String(value));
    } catch (err) {}
  }

  function updateHomeHole() {
    var cleared = Math.min(LEVELS.length, readProgress());
    if (bestReadout) {
      bestReadout.textContent =
        cleared >= LEVELS.length
          ? "COURSE CLEAR"
          : "HOLE " + (cleared + 1) + " / " + LEVELS.length;
    }
  }

  function parseCard(token) {
    return { t: token.charAt(0), n: parseInt(token.slice(1), 10), used: false };
  }

  function at(x, y) {
    if (y < 0 || y >= rows || x < 0 || x >= cols) return "#";
    return grid[y][x];
  }

  function loadLevel(index) {
    var spec = LEVELS[index];
    rows = spec.rows.length;
    cols = spec.rows[0].length;
    grid = spec.rows.map(function (row) {
      return row.split("");
    });
    var y;
    var x;
    for (y = 0; y < rows; y += 1) {
      for (x = 0; x < cols; x += 1) {
        if (grid[y][x] === "B") {
          start = { x: x, y: y };
          grid[y][x] = ".";
        }
        if (grid[y][x] === "H") hole = { x: x, y: y };
      }
    }
    ball = { x: start.x, y: start.y };
    drawBall = { x: start.x, y: start.y, z: 0 };
    cards = spec.cards.map(parseCard);
    selected = -1;
    aiming = false;
    history = [];
    flash = "";
  }

  function snapshot() {
    return {
      x: ball.x,
      y: ball.y,
      cards: cards.map(function (card) {
        return { t: card.t, n: card.n, used: card.used };
      }),
    };
  }

  function restore(snap) {
    ball = { x: snap.x, y: snap.y };
    drawBall = { x: snap.x, y: snap.y, z: 0 };
    cards = snap.cards.map(function (card) {
      return { t: card.t, n: card.n, used: card.used };
    });
  }

  function remainingCards() {
    return cards.some(function (card) {
      return !card.used;
    });
  }

  function planStroke(card, dir) {
    var d = DIRS[dir];
    var path = [{ x: ball.x, y: ball.y, z: 0 }];
    var x = ball.x;
    var y = ball.y;
    var i;
    var nx;
    var ny;
    var cell;
    if (card.t === "J") {
      nx = x + d.x * card.n;
      ny = y + d.y * card.n;
      cell = at(nx, ny);
      path.push({ x: nx, y: ny, z: 1 });
      if (cell === "#" || cell === "W") return { path: path, fail: true, win: false, x: x, y: y };
      return { path: path, fail: false, win: nx === hole.x && ny === hole.y, x: nx, y: ny };
    }
    if (at(x, y) === "S") {
      return { path: path, fail: false, win: false, x: x, y: y, stuck: true };
    }
    for (i = 0; i < card.n; i += 1) {
      nx = x + d.x;
      ny = y + d.y;
      cell = at(nx, ny);
      if (cell === "W") break;
      if (cell === "#") {
        path.push({ x: nx, y: ny, z: 0 });
        return { path: path, fail: true, win: false, x: x, y: y };
      }
      x = nx;
      y = ny;
      path.push({ x: x, y: y, z: 0 });
      if (cell === "S") break;
    }
    return {
      path: path,
      fail: false,
      win: x === hole.x && y === hole.y,
      x: x,
      y: y,
    };
  }

  function cellBox() {
    var maxW = 584;
    var maxH = 480;
    var size = Math.min(72, Math.floor(maxW / cols), Math.floor(maxH / rows));
    var w = cols * size;
    var h = rows * size;
    return { size: size, ox: Math.round((600 - w) / 2), oy: Math.round((88 + (480 - h) / 2)) };
  }

  function drawGrid() {
    var box = cellBox();
    var y;
    var x;
    var cell;
    var px;
    var py;
    ctx.clearRect(0, 0, 600, 600);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("HOLE " + (holeIndex + 1) + " / " + LEVELS.length, 28, 45);
    ctx.textAlign = "right";
    ctx.fillStyle = CYAN;
    ctx.fillText(aiming ? "SWIPE" : "PINCH CARD", 572, 45);

    for (y = 0; y < rows; y += 1) {
      for (x = 0; x < cols; x += 1) {
        cell = at(x, y);
        px = box.ox + x * box.size;
        py = box.oy + y * box.size;
        if (cell === "#") ctx.fillStyle = PIT;
        else if (cell === "S") ctx.fillStyle = SAND;
        else if (cell === "W") ctx.fillStyle = WALL;
        else ctx.fillStyle = FAIR;
        ctx.fillRect(px + 2, py + 2, box.size - 4, box.size - 4);
        if (x === hole.x && y === hole.y) {
          ctx.beginPath();
          ctx.arc(px + box.size / 2, py + box.size / 2, box.size * 0.22, 0, Math.PI * 2);
          ctx.fillStyle = "#0A0A0C";
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = CREAM;
          ctx.stroke();
        }
      }
    }

    var bx = box.ox + (drawBall.x + 0.5) * box.size;
    var by = box.oy + (drawBall.y + 0.5) * box.size - drawBall.z * box.size * 0.45;
    ctx.beginPath();
    ctx.arc(bx, by, box.size * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, box.size * 0.18, 0, Math.PI * 2);
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (flash) {
      ctx.textAlign = "center";
      ctx.fillStyle = flash === "HOLED" ? GREEN : "#FF3333";
      ctx.font = "700 28px ui-monospace, monospace";
      ctx.fillText(flash, 300, 78);
    }
  }

  function showFlash(msg) {
    flash = msg;
    drawGrid();
    setTimeout(function () {
      if (flash === msg) {
        flash = "";
        if (running && !animating) drawGrid();
      }
    }, 800);
  }

  function renderTray() {
    tray.innerHTML = "";
    playBtn.classList.remove("live");
    if (aiming) {
      var hint = document.createElement("div");
      hint.className = "aim-hint";
      hint.textContent = (cards[selected].t === "J" ? "JUMP " : "ROLL ") + cards[selected].n + "  ·  SWIPE";
      tray.appendChild(hint);
      focusPlay();
      return;
    }
    cards.forEach(function (card, i) {
      if (card.used) return;
      var button = document.createElement("button");
      button.className = "focusable";
      button.setAttribute("data-action", "card");
      button.setAttribute("data-index", String(i));
      button.textContent = (card.t === "J" ? "JUMP " : "ROLL ") + card.n;
      tray.appendChild(button);
    });
    var undo = document.createElement("button");
    undo.className = "focusable";
    undo.setAttribute("data-action", "undo");
    undo.textContent = "UNDO";
    tray.appendChild(undo);
    var reset = document.createElement("button");
    reset.className = "focusable";
    reset.setAttribute("data-action", "reset");
    reset.textContent = "RESET";
    tray.appendChild(reset);
    focusFirst(tray);
  }

  function animatePath(result, done) {
    var path = result.path;
    if (path.length < 2) {
      done();
      return;
    }
    var step = 0;
    var t = 0;
    function tick(ts) {
      if (!lastTs) lastTs = ts;
      var dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      t += dt * 3.2;
      var from = path[step];
      var to = path[step + 1];
      var p = Math.min(1, t);
      drawBall.x = from.x + (to.x - from.x) * p;
      drawBall.y = from.y + (to.y - from.y) * p;
      drawBall.z = Math.max(from.z, to.z) * Math.sin(p * Math.PI);
      drawGrid();
      if (p >= 1) {
        step += 1;
        t = 0;
        if (step >= path.length - 1) {
          drawBall = { x: result.x, y: result.y, z: 0 };
          done();
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    }
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  function finishStroke(result) {
    animating = false;
    aiming = false;
    selected = -1;
    if (result.fail) {
      showFlash("OUT");
      restore(history.pop());
    } else if (result.stuck) {
      showFlash("NEED JUMP");
    } else {
      ball = { x: result.x, y: result.y };
      drawBall = { x: ball.x, y: ball.y, z: 0 };
      if (result.win) {
        showFlash("HOLED");
        renderTray();
        completeHole();
        return;
      }
      if (!remainingCards()) showFlash("NO CARDS");
    }
    drawGrid();
    renderTray();
  }

  function playStroke(dir) {
    var card = cards[selected];
    if (!card || animating) return;
    var result = planStroke(card, dir);
    history.push(snapshot());
    card.used = true;
    aiming = false;
    animating = true;
    playBtn.classList.remove("live");
    animatePath(result, function () {
      finishStroke(result);
    });
  }

  function chooseCard(index) {
    if (animating || paused) return;
    selected = index;
    aiming = true;
    renderTray();
    drawGrid();
  }

  function cancelAim() {
    if (!aiming) return;
    aiming = false;
    selected = -1;
    renderTray();
    drawGrid();
  }

  function undo() {
    if (animating || !history.length) return;
    aiming = false;
    selected = -1;
    restore(history.pop());
    drawGrid();
    renderTray();
  }

  function startHole(index) {
    holeIndex = index;
    running = true;
    paused = false;
    animating = false;
    pauseOverlay.classList.add("hidden");
    holeOverlay.classList.add("hidden");
    loadLevel(holeIndex);
    navigateTo("play");
    drawGrid();
    renderTray();
  }

  function completeHole() {
    var next = holeIndex + 1;
    writeProgress(Math.max(readProgress(), next));
    updateHomeHole();
    paused = true;
    holeTitle.textContent = next >= LEVELS.length ? "COURSE CLEAR" : "HOLED";
    var nextBtn = holeOverlay.querySelector('[data-action="next"]');
    if (nextBtn) nextBtn.textContent = next >= LEVELS.length ? "HOME" : "NEXT";
    holeOverlay.classList.remove("hidden");
    focusFirst(holeOverlay);
  }

  function pauseRun() {
    if (!running || paused || animating) return;
    if (aiming) {
      cancelAim();
      return;
    }
    paused = true;
    pauseOverlay.classList.remove("hidden");
    focusFirst(pauseOverlay);
  }

  function resumeRun() {
    paused = false;
    pauseOverlay.classList.add("hidden");
    renderTray();
  }

  function resetHole() {
    pauseOverlay.classList.add("hidden");
    holeOverlay.classList.add("hidden");
    paused = false;
    startHole(holeIndex);
  }

  function stopRun() {
    running = false;
    paused = false;
    aiming = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pauseOverlay.classList.add("hidden");
    holeOverlay.classList.add("hidden");
    navigateTo("home");
    updateHomeHole();
  }

  function handlePlayKey(event) {
    var key = playKey(event);
    if (key === "escape") {
      pauseRun();
      return;
    }
    if (!aiming || animating || event.repeat) return;
    if (key === "up" || key === "down" || key === "left" || key === "right") playStroke(key);
    else if (key === "enter") cancelAim();
  }

  function handleAction(action, target) {
    if (action === "play") {
      startHole(Math.min(readProgress(), LEVELS.length - 1));
    } else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") stopRun();
    else if (action === "card") chooseCard(parseInt(target.getAttribute("data-index"), 10));
    else if (action === "undo") undo();
    else if (action === "reset") resetHole();
    else if (action === "resume") resumeRun();
    else if (action === "cancel-aim") cancelAim();
    else if (action === "next") {
      if (holeIndex + 1 >= LEVELS.length) stopRun();
      else startHole(holeIndex + 1);
    }
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "play" && running && aiming && !paused) {
      handlePlayKey(event);
      event.preventDefault();
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
      case DPAD.BACK:
        if (currentScreen === "play") pauseRun();
        else if (currentScreen !== "home") navigateTo("home");
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    handleAction(button.getAttribute("data-action"), button);
  });

  collectScreens();
  updateHomeHole();
  focusFirst(screens.home);
})();
