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

  var COLS = 8;
  var ROWS = 14;
  var CELL = 32;
  var OX = 52;
  var OY = 86;
  var BEST_KEY = "well-best";
  var ORANGE = "#FF6B35";
  var CYAN = "#00D4FF";
  var AMBER = "#FFB000";
  var GREEN = "#00FF88";
  var VIOLET = "#B388FF";
  var RED = "#FF5A7A";
  var CREAM = "#FFFFFF";
  var SURFACE = "#1C1E21";
  var LINE = "#2A2D31";

  var SHAPES = {
    I: [[[1, 1, 1, 1]], [[1], [1], [1], [1]]],
    O: [[[1, 1], [1, 1]]],
    T: [
      [[0, 1, 0], [1, 1, 1]],
      [[1, 0], [1, 1], [1, 0]],
      [[1, 1, 1], [0, 1, 0]],
      [[0, 1], [1, 1], [0, 1]],
    ],
    L: [
      [[1, 0, 0], [1, 1, 1]],
      [[1, 1], [1, 0], [1, 0]],
      [[1, 1, 1], [0, 0, 1]],
      [[0, 1], [0, 1], [1, 1]],
    ],
    J: [
      [[0, 0, 1], [1, 1, 1]],
      [[1, 0], [1, 0], [1, 1]],
      [[1, 1, 1], [1, 0, 0]],
      [[1, 1], [0, 1], [0, 1]],
    ],
    S: [
      [[0, 1, 1], [1, 1, 0]],
      [[1, 0], [1, 1], [0, 1]],
    ],
    Z: [
      [[1, 1, 0], [0, 1, 1]],
      [[0, 1], [1, 1], [1, 0]],
    ],
  };

  var COLORS = {
    I: CYAN,
    O: AMBER,
    T: VIOLET,
    L: ORANGE,
    J: "#4DA3FF",
    S: GREEN,
    Z: RED,
  };

  var BAG = ["I", "O", "T", "L", "J", "S", "Z"];

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var playBtn = document.getElementById("play-btn");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var board = [];
  var piece = null;
  var nextType = "T";
  var holdType = "";
  var holdUsed = false;
  var bag = [];
  var score = 0;
  var lines = 0;
  var best = 0;
  var fallT = 0;
  var dropAt = 0;
  var holdAt = 0;

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
    if (playBtn) playBtn.focus();
  }

  function pad(n, width) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < width) s = "0" + s;
    return s;
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

  function focusRoot() {
    if (currentScreen === "play" && paused) return pauseOverlay;
    return screens[currentScreen];
  }

  function navigateTo(screenId) {
    Object.keys(screens).forEach(function (id) {
      screens[id].classList.add("hidden");
    });
    if (!screens[screenId]) return;
    screens[screenId].classList.remove("hidden");
    currentScreen = screenId;
    if (screenId === "play") focusPlay();
    else focusFirst(screens[screenId]);
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

  function emptyBoard() {
    var rows = [];
    var r;
    for (r = 0; r < ROWS; r += 1) {
      rows.push(new Array(COLS).fill(""));
    }
    return rows;
  }

  function refillBag() {
    bag = BAG.slice();
    var i;
    for (i = bag.length - 1; i > 0; i -= 1) {
      var j = (Math.random() * (i + 1)) | 0;
      var tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
  }

  function takeType() {
    if (!bag.length) refillBag();
    return bag.pop();
  }

  function cells(type, rot, x, y) {
    var grid = SHAPES[type][rot % SHAPES[type].length];
    var out = [];
    var r;
    var c;
    for (r = 0; r < grid.length; r += 1) {
      for (c = 0; c < grid[r].length; c += 1) {
        if (grid[r][c]) out.push({ x: x + c, y: y + r });
      }
    }
    return out;
  }

  function fits(type, rot, x, y) {
    return cells(type, rot, x, y).every(function (cell) {
      if (cell.x < 0 || cell.x >= COLS || cell.y >= ROWS) return false;
      if (cell.y < 0) return true;
      return !board[cell.y][cell.x];
    });
  }

  function spawn() {
    var type = nextType;
    nextType = takeType();
    var rot = 0;
    var x = 3;
    var y = 0;
    if (type === "I") x = 2;
    if (!fits(type, rot, x, y)) return false;
    piece = { type: type, rot: rot, x: x, y: y };
    fallT = 0;
    return true;
  }

  function spawnType(type) {
    var rot = 0;
    var x = 3;
    var y = 0;
    if (type === "I") x = 2;
    if (!fits(type, rot, x, y)) return false;
    piece = { type: type, rot: rot, x: x, y: y };
    fallT = 0;
    return true;
  }

  function holdPiece() {
    if (!piece || !running || paused || holdUsed) return;
    var now = performance.now();
    if (now - holdAt < 160) return;
    holdAt = now;
    holdUsed = true;
    var current = piece.type;
    if (!holdType) {
      holdType = current;
      if (!spawn()) endRun();
      return;
    }
    var swap = holdType;
    holdType = current;
    if (!spawnType(swap)) endRun();
  }

  function lockPiece() {
    cells(piece.type, piece.rot, piece.x, piece.y).forEach(function (cell) {
      if (cell.y >= 0) board[cell.y][cell.x] = piece.type;
    });
    var cleared = 0;
    var r;
    for (r = ROWS - 1; r >= 0; r -= 1) {
      if (board[r].every(function (cell) { return cell; })) {
        board.splice(r, 1);
        board.unshift(new Array(COLS).fill(""));
        cleared += 1;
        r += 1;
      }
    }
    if (cleared) {
      lines += cleared;
      score += [0, 100, 300, 500, 800][cleared] * (1 + (lines / 10) | 0);
    } else {
      score += 8;
    }
    if (!spawn()) endRun();
    holdUsed = false;
  }

  function move(dx, dy) {
    if (!piece) return false;
    if (fits(piece.type, piece.rot, piece.x + dx, piece.y + dy)) {
      piece.x += dx;
      piece.y += dy;
      return true;
    }
    return false;
  }

  function rotate(step) {
    if (!piece) return;
    var count = SHAPES[piece.type].length;
    var next = ((piece.rot + step) % count + count) % count;
    var kicks = [0, -1, 1, -2, 2];
    var i;
    for (i = 0; i < kicks.length; i += 1) {
      if (fits(piece.type, next, piece.x + kicks[i], piece.y)) {
        piece.rot = next;
        piece.x += kicks[i];
        return;
      }
    }
  }

  function softDrop() {
    if (!piece || !running || paused) return;
    if (move(0, 1)) {
      score += 1;
      fallT = 0;
    }
  }

  function gravity() {
    return Math.max(0.14, 0.72 - lines * 0.035);
  }

  function startRun() {
    running = true;
    paused = false;
    board = emptyBoard();
    bag = [];
    refillBag();
    nextType = takeType();
    holdType = "";
    holdUsed = false;
    score = 0;
    lines = 0;
    fallT = 0;
    lastTs = 0;
    dropAt = 0;
    holdAt = 0;
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    if (!spawn()) {
      endRun();
      return;
    }
    loop();
  }

  function pauseRun() {
    if (!running || paused) return;
    paused = true;
    pauseOverlay.classList.remove("hidden");
    focusFirst(pauseOverlay);
  }

  function resumeRun() {
    if (!running || !paused) return;
    paused = false;
    lastTs = 0;
    pauseOverlay.classList.add("hidden");
    focusPlay();
  }

  function stopLoop() {
    running = false;
    paused = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pauseOverlay.classList.add("hidden");
  }

  function endRun() {
    if (!running) return;
    if (score > best) {
      best = score;
      writeBest(best);
      updateBestReadout();
    }
    stopLoop();
    if (overStats) {
      overStats.innerHTML =
        "SCORE " + pad(score, 5) + "<br>LINES " + pad(lines, 3) + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function update(dt) {
    fallT += dt;
    if (fallT >= gravity()) {
      fallT = 0;
      if (!move(0, 1)) lockPiece();
    }
  }

  function ghostY() {
    if (!piece) return 0;
    var y = piece.y;
    while (fits(piece.type, piece.rot, piece.x, y + 1)) y += 1;
    return y;
  }

  function drawCell(x, y, color, alpha) {
    if (y < 0) return;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(OX + x * CELL + 1, OY + y * CELL + 1, CELL - 2, CELL - 2);
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, 600, 600);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(OX - 8, OY - 8, COLS * CELL + 16, ROWS * CELL + 16);

    var r;
    var c;
    for (r = 0; r < ROWS; r += 1) {
      for (c = 0; c < COLS; c += 1) {
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(OX + c * CELL, OY + r * CELL, CELL, CELL);
        if (board[r][c]) drawCell(c, r, COLORS[board[r][c]]);
      }
    }

    if (piece) {
      var gy = ghostY();
      cells(piece.type, piece.rot, piece.x, gy).forEach(function (cell) {
        drawCell(cell.x, cell.y, COLORS[piece.type], 0.22);
      });
      cells(piece.type, piece.rot, piece.x, piece.y).forEach(function (cell) {
        drawCell(cell.x, cell.y, COLORS[piece.type]);
      });
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(336, 86, 212, 148);
    ctx.fillStyle = CREAM;
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("NEXT", 352, 114);
    cells(nextType, 0, 0, 0).forEach(function (cell) {
      ctx.fillStyle = COLORS[nextType];
      ctx.fillRect(368 + cell.x * 26, 128 + cell.y * 26, 24, 24);
    });

    ctx.fillStyle = SURFACE;
    ctx.fillRect(336, 246, 212, 148);
    ctx.fillStyle = CREAM;
    ctx.fillText("HOLD", 352, 274);
    if (holdType) {
      ctx.globalAlpha = holdUsed ? 0.4 : 1;
      cells(holdType, 0, 0, 0).forEach(function (cell) {
        ctx.fillStyle = COLORS[holdType];
        ctx.fillRect(368 + cell.x * 26, 288 + cell.y * 26, 24, 24);
      });
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#B0B3B8";
      ctx.font = "700 13px ui-monospace, monospace";
      ctx.fillText("PINCH TO STOW", 352, 320);
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(336, 406, 212, 148);
    ctx.fillStyle = CREAM;
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.fillText("SCORE " + pad(score, 5), 352, 440);
    ctx.fillText("LINES " + pad(lines, 3), 352, 472);
    ctx.fillStyle = "#B0B3B8";
    ctx.font = "700 13px ui-monospace, monospace";
    ctx.fillText("DOWN SOFT DROP", 352, 504);
    ctx.fillStyle = ORANGE;
    ctx.fillText("PINCH HOLD", 352, 528);

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.fillText("WELL", 28, 45);
  }

  function loop(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (paused) return;
    if (!lastTs) lastTs = ts || performance.now();
    var now = ts || performance.now();
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;
    update(dt);
    draw();
  }

  function handlePlayKey(event) {
    var key = playKey(event);
    if (key === "escape") {
      pauseRun();
      return;
    }
    if (key === "down") {
      softDrop();
      focusPlay();
      return;
    }
    if (event.repeat) return;
    if (key === "left") move(-1, 0);
    else if (key === "right") move(1, 0);
    else if (key === "up") rotate(1);
    else if (key === "enter") holdPiece();
    focusPlay();
  }

  function handleAction(action) {
    if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopLoop();
      navigateTo("home");
    }     else if (action === "resume") resumeRun();
    else if (action === "hold") holdPiece();
  }

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "play" && running && !paused) {
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
        if (currentScreen === "play" && paused) resumeRun();
        else if (currentScreen !== "home") {
          stopLoop();
          navigateTo("home");
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    handleAction(button.getAttribute("data-action"));
  });

  collectScreens();
  best = readBest();
  updateBestReadout();
  focusFirst(screens.home);
})();
