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

  var GRID = 4;
  var CELL = 108;
  var GAP = 10;
  var BOARD = GRID * CELL + (GRID - 1) * GAP;
  var OX = Math.round((600 - BOARD) / 2);
  var OY = 96;
  var BEST_KEY = "trio-best";
  var CREAM = "#FFFFFF";
  var MUTED = "#B0B3B8";
  var SURFACE = "#1C1E21";
  var LINE = "#2A2D31";
  var BLUE = "#4DA3FF";
  var RED = "#FF5A7A";

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
  var board = [];
  var score = 0;
  var best = 0;
  var incoming = 1;

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

  function emptyGrid() {
    var grid = [];
    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      grid[r] = [];
      for (c = 0; c < GRID; c += 1) grid[r][c] = 0;
    }
    return grid;
  }

  function cloneGrid(grid) {
    return grid.map(function (row) {
      return row.slice();
    });
  }

  function maxTile() {
    var m = 1;
    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        if (board[r][c] > m) m = board[r][c];
      }
    }
    return m;
  }

  function canMerge(a, b) {
    if (!a || !b) return false;
    if ((a === 1 && b === 2) || (a === 2 && b === 1)) return true;
    return a >= 3 && a === b;
  }

  function slideLine(line) {
    var next = line.slice();
    var moved = false;
    var i;
    for (i = 0; i < GRID - 1; i += 1) {
      var a = next[i];
      var b = next[i + 1];
      if (!b) continue;
      if (!a) {
        next[i] = b;
        next[i + 1] = 0;
        moved = true;
      } else if (canMerge(a, b)) {
        next[i] = a + b;
        next[i + 1] = 0;
        moved = true;
      }
    }
    return { line: next, moved: moved };
  }

  function getLine(dir, index) {
    var i;
    var line = [];
    if (dir === "left") return board[index].slice();
    if (dir === "right") {
      for (i = GRID - 1; i >= 0; i -= 1) line.push(board[index][i]);
      return line;
    }
    if (dir === "up") {
      for (i = 0; i < GRID; i += 1) line.push(board[i][index]);
      return line;
    }
    for (i = GRID - 1; i >= 0; i -= 1) line.push(board[i][index]);
    return line;
  }

  function setLine(dir, index, line) {
    var i;
    if (dir === "left") {
      board[index] = line.slice();
      return;
    }
    if (dir === "right") {
      for (i = 0; i < GRID; i += 1) board[index][GRID - 1 - i] = line[i];
      return;
    }
    if (dir === "up") {
      for (i = 0; i < GRID; i += 1) board[i][index] = line[i];
      return;
    }
    for (i = 0; i < GRID; i += 1) board[GRID - 1 - i][index] = line[i];
  }

  function shifted(dir) {
    var next = cloneGrid(board);
    var movedLines = [];
    var i;
    var result;
    board = next;
    for (i = 0; i < GRID; i += 1) {
      result = slideLine(getLine(dir, i));
      setLine(dir, i, result.line);
      if (result.moved) movedLines.push(i);
    }
    return { moved: movedLines.length > 0, lines: movedLines };
  }

  function canMove() {
    var dirs = ["up", "down", "left", "right"];
    var saved = cloneGrid(board);
    var i;
    var result;
    for (i = 0; i < dirs.length; i += 1) {
      board = cloneGrid(saved);
      result = shifted(dirs[i]);
      if (result.moved) {
        board = saved;
        return true;
      }
    }
    board = saved;
    return false;
  }

  function pickIncoming() {
    var max = maxTile();
    var roll = Math.random();
    if (max >= 48 && roll < 0.06) {
      var bonus = 6;
      while (bonus * 8 <= max && Math.random() < 0.5) bonus *= 2;
      if (bonus * 8 <= max) return bonus;
    }
    if (roll < 0.42) return 1;
    if (roll < 0.84) return 2;
    return 3;
  }

  function spawnOnEdge(dir, lines) {
    if (!lines.length) return;
    var index = lines[(Math.random() * lines.length) | 0];
    if (dir === "left") board[index][GRID - 1] = incoming;
    else if (dir === "right") board[index][0] = incoming;
    else if (dir === "up") board[GRID - 1][index] = incoming;
    else board[0][index] = incoming;
    incoming = pickIncoming();
  }

  function boardScore() {
    var total = 0;
    var r;
    var c;
    var v;
    var n;
    var s;
    var i;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        v = board[r][c];
        if (v < 3) continue;
        n = 1;
        s = 3;
        while (s < v) {
          s *= 2;
          n += 1;
        }
        var pts = 3;
        for (i = 1; i < n; i += 1) pts *= 3;
        total += pts;
      }
    }
    return total;
  }

  function fillStart() {
    board = emptyGrid();
    var spots = [];
    var r;
    var c;
    var i;
    var pick;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) spots.push({ r: r, c: c });
    }
    for (i = spots.length - 1; i > 0; i -= 1) {
      pick = (Math.random() * (i + 1)) | 0;
      var tmp = spots[i];
      spots[i] = spots[pick];
      spots[pick] = tmp;
    }
    for (i = 0; i < 9; i += 1) {
      var roll = Math.random();
      board[spots[i].r][spots[i].c] = roll < 0.4 ? 1 : roll < 0.8 ? 2 : 3;
    }
    incoming = pickIncoming();
  }

  function slide(dir) {
    var result = shifted(dir);
    if (!result.moved) return;
    spawnOnEdge(dir, result.lines);
    score = boardScore();
    draw();
    if (!canMove()) endRun();
  }

  function startRun() {
    running = true;
    paused = false;
    score = 0;
    fillStart();
    score = boardScore();
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    draw();
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
    pauseOverlay.classList.add("hidden");
    focusPlay();
  }

  function stopLoop() {
    running = false;
    paused = false;
    pauseOverlay.classList.add("hidden");
  }

  function endRun() {
    if (!running) return;
    score = boardScore();
    if (score > best) {
      best = score;
      writeBest(best);
      updateBestReadout();
    }
    stopLoop();
    if (overStats) {
      overStats.innerHTML = "SCORE " + pad(score, 5) + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function tileFill(v) {
    if (v === 1) return BLUE;
    if (v === 2) return RED;
    if (v >= 384) return "#B388FF";
    if (v >= 96) return "#FFB000";
    if (v >= 24) return "#00D4FF";
    if (v >= 6) return "#3A3D42";
    return "#2A2D31";
  }

  function tileFont(v) {
    if (v >= 1000) return "700 28px ui-monospace, monospace";
    if (v >= 100) return "700 36px ui-monospace, monospace";
    return "700 44px ui-monospace, monospace";
  }

  function drawTile(x, y, v, size) {
    ctx.fillStyle = v ? tileFill(v) : LINE;
    ctx.fillRect(x, y, size, size);
    if (!v) return;
    ctx.fillStyle = v === 1 || v === 2 || v === 3 ? CREAM : v >= 24 ? "#0A0B0C" : CREAM;
    ctx.font = tileFont(v);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(v), x + size / 2, y + size / 2 + 2);
  }

  function draw() {
    ctx.clearRect(0, 0, 600, 600);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(OX - 12, OY - 12, BOARD + 24, BOARD + 24);

    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        drawTile(OX + c * (CELL + GAP), OY + r * (CELL + GAP), board[r][c], CELL);
      }
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 56);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("SCORE " + pad(score, 5), 28, 52);
    ctx.textAlign = "right";
    ctx.fillStyle = MUTED;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText("NEXT", 470, 40);
    drawTile(486, 22, incoming, 36);

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 548, 568, 36);
    ctx.fillStyle = MUTED;
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("SWIPE ONE SPACE  ·  1 + 2 = 3", 300, 572);
  }

  function handlePlayKey(event) {
    var key = playKey(event);
    if (key === "escape") {
      pauseRun();
      return;
    }
    if (event.repeat) return;
    if (key === "enter") {
      focusPlay();
      return;
    }
    if (key === "up" || key === "down" || key === "left" || key === "right") slide(key);
    focusPlay();
  }

  function handleAction(action) {
    if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopLoop();
      navigateTo("home");
    } else if (action === "resume") resumeRun();
    else if (action === "hold") focusPlay();
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
