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

  var GRID = 6;
  var CELL = 76;
  var GAP = 8;
  var BOARD = GRID * CELL + (GRID - 1) * GAP;
  var OX = Math.round((600 - BOARD) / 2);
  var OY = 86;
  var UNDOS = 5;
  var BEST_KEY = "merge-best";
  var RUN_KEY = "merge-run";
  var SPAWN_FAST = 0.9;
  var SPAWN_SLOW = 3.2;
  var HINT_T = 3.2;
  var CREAM = "#FFFFFF";
  var MUTED = "#B0B3B8";
  var SURFACE = "#1C1E21";
  var LINE = "#2A2D31";
  var AMBER = "#FFB000";

  var TILE = {
    2: "#3A3D42",
    4: "#4A5560",
    8: "#9C4221",
    16: "#C05621",
    32: "#DD6B20",
    64: "#ED8936",
    128: "#00D4FF",
    256: "#00FF88",
    512: "#FFB000",
    1024: "#FF6B35",
    2048: "#FFFFFF",
    4096: "#B388FF",
    8192: "#FF5A7A",
  };

  var screens = {};
  var currentScreen = "home";
  var canvas = document.getElementById("hud");
  var ctx = canvas.getContext("2d");
  var pauseOverlay = document.getElementById("pause-overlay");
  var playBtn = document.getElementById("play-btn");
  var continueBtn = document.getElementById("continue-btn");
  var playMenuBtn = document.getElementById("play-menu-btn");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");

  var running = false;
  var paused = false;
  var rafId = 0;
  var lastTs = 0;
  var board = [];
  var score = 0;
  var best = 0;
  var undos = UNDOS;
  var history = [];
  var hintT = 0;
  var spawnT = 0;
  var audioCtx = null;

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

  function validGrid(grid) {
    if (!grid || grid.length !== GRID) return false;
    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      if (!grid[r] || grid[r].length !== GRID) return false;
      for (c = 0; c < GRID; c += 1) {
        var v = grid[r][c];
        if (typeof v !== "number" || v < 0 || v % 1 !== 0) return false;
        if (v !== 0 && (v & (v - 1)) !== 0) return false;
      }
    }
    return true;
  }

  function parseSave(raw) {
    if (!raw) return null;
    var data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!data || !validGrid(data.board)) return null;
    if (typeof data.score !== "number" || data.score < 0) return null;
    if (typeof data.undos !== "number" || data.undos < 0 || data.undos > UNDOS) return null;
    if (typeof data.spawnT !== "number" || !isFinite(data.spawnT)) return null;
    if (!Array.isArray(data.history)) return null;
    var i;
    for (i = 0; i < data.history.length; i += 1) {
      var step = data.history[i];
      if (!step || !validGrid(step.board) || typeof step.score !== "number") return null;
    }
    return data;
  }

  function peekSave() {
    try {
      return parseSave(localStorage.getItem(RUN_KEY));
    } catch (err) {
      return null;
    }
  }

  function writeSave() {
    if (!board || !board.length) return;
    try {
      localStorage.setItem(
        RUN_KEY,
        JSON.stringify({
          board: board,
          score: score,
          undos: undos,
          spawnT: spawnT,
          history: history,
        })
      );
    } catch (err) {}
  }

  function clearSave() {
    try {
      localStorage.removeItem(RUN_KEY);
    } catch (err) {}
  }

  function applySave(data) {
    board = cloneGrid(data.board);
    score = data.score;
    undos = data.undos;
    spawnT = Math.max(0.2, data.spawnT);
    history = data.history.map(function (step) {
      return { board: cloneGrid(step.board), score: step.score };
    });
    hintT = 0;
  }

  function updateMenu() {
    var has = !!peekSave();
    if (continueBtn) {
      if (has) continueBtn.classList.remove("hidden");
      else continueBtn.classList.add("hidden");
    }
    if (playMenuBtn) playMenuBtn.textContent = has ? "NEW GAME" : "PLAY";
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

  function empties() {
    var out = [];
    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        if (!board[r][c]) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  function spawn() {
    var open = empties();
    if (!open.length) return;
    var pick = open[(Math.random() * open.length) | 0];
    board[pick.r][pick.c] = Math.random() < 0.82 ? 2 : 4;
  }

  function spawnN(n) {
    var i;
    for (i = 0; i < n; i += 1) spawn();
  }

  function spawnInterval() {
    var open = empties().length / (GRID * GRID);
    var gap = SPAWN_SLOW - (SPAWN_SLOW - SPAWN_FAST) * open;
    var scoreMul = Math.max(0.48, 1 / (1 + score / 4500));
    return Math.max(0.5, gap * scoreMul);
  }

  function idleSpawnCount() {
    return empties().length >= 18 ? 2 : 1;
  }

  function ensureAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function beep(freq, dur, type, vol, slideTo) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(Math.max(40, freq), t);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    }
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function playMergeSfx(maxTile, mergeCount) {
    if (!maxTile) return;
    var rank = Math.log(maxTile) / Math.LN2;
    var n = Math.max(0, rank - 2);
    var extra = Math.min(3, Math.max(0, (mergeCount || 1) - 1));
    var richness = n + extra * 0.65;
    var ping = 400 * Math.pow(1.065, Math.min(n, 10));
    if (ping > 920) ping = 920;
    var vol = 0.07 + Math.min(0.09, richness * 0.008);
    var dur = 0.1 + Math.min(0.18, richness * 0.016);

    beep(ping * 0.9, dur, "triangle", vol, ping * 1.16);

    if (richness >= 3) {
      beep(ping * 1.5, dur + 0.05, "sine", vol * 0.5);
    }
    if (richness >= 6) {
      beep(98 + n * 3, 0.24 + richness * 0.01, "sine", 0.11, 64);
      beep(ping * 2, dur + 0.08, "sine", vol * 0.32);
    }
    if (richness >= 9) {
      beep(ping * 1.25, dur + 0.14, "triangle", vol * 0.42);
      beep(72, 0.36, "sine", 0.13, 48);
    }
  }

  function slideLine(values, reverse) {
    var vals = values.filter(function (v) {
      return v;
    });
    if (reverse) vals.reverse();
    var merged = [];
    var gained = 0;
    var maxTile = 0;
    var merges = 0;
    var i = 0;
    while (i < vals.length) {
      if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
        var n = vals[i] * 2;
        merged.push(n);
        gained += n;
        merges += 1;
        if (n > maxTile) maxTile = n;
        i += 2;
      } else {
        merged.push(vals[i]);
        i += 1;
      }
    }
    while (merged.length < GRID) merged.push(0);
    if (reverse) merged.reverse();
    return { line: merged, gained: gained, maxTile: maxTile, merges: merges };
  }

  function shifted(dir) {
    var next = cloneGrid(board);
    var gained = 0;
    var maxTile = 0;
    var merges = 0;
    var r;
    var c;
    if (dir === "left" || dir === "right") {
      for (r = 0; r < GRID; r += 1) {
        var row = slideLine(next[r], dir === "right");
        next[r] = row.line;
        gained += row.gained;
        merges += row.merges;
        if (row.maxTile > maxTile) maxTile = row.maxTile;
      }
    } else {
      for (c = 0; c < GRID; c += 1) {
        var col = [];
        for (r = 0; r < GRID; r += 1) col.push(next[r][c]);
        var res = slideLine(col, dir === "down");
        for (r = 0; r < GRID; r += 1) next[r][c] = res.line[r];
        gained += res.gained;
        merges += res.merges;
        if (res.maxTile > maxTile) maxTile = res.maxTile;
      }
    }
    var changed = false;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        if (next[r][c] !== board[r][c]) changed = true;
      }
    }
    return { board: next, gained: gained, changed: changed, maxTile: maxTile, merges: merges };
  }

  function canMove() {
    if (empties().length) return true;
    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        var v = board[r][c];
        if (c + 1 < GRID && board[r][c + 1] === v) return true;
        if (r + 1 < GRID && board[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  function pushHistory() {
    history.push({ board: cloneGrid(board), score: score });
    if (history.length > 20) history.shift();
  }

  function slide(dir) {
    var result = shifted(dir);
    if (!result.changed) return;
    pushHistory();
    board = result.board;
    score += result.gained;
    if (result.gained) playMergeSfx(result.maxTile, result.merges);
    spawnN(2);
    spawnT = spawnInterval();
    writeSave();
    draw();
    if (!canMove()) endRun();
  }

  function undo() {
    if (!running || paused || !undos || !history.length) return;
    var prev = history.pop();
    board = prev.board;
    score = prev.score;
    undos -= 1;
    writeSave();
    draw();
  }

  function startRun() {
    ensureAudio();
    clearSave();
    running = true;
    paused = false;
    board = emptyGrid();
    score = 0;
    undos = UNDOS;
    history = [];
    hintT = HINT_T;
    lastTs = 0;
    spawn();
    spawn();
    spawnT = spawnInterval();
    writeSave();
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    loop();
  }

  function continueRun() {
    var data = peekSave();
    if (!data) {
      startRun();
      return;
    }
    applySave(data);
    if (!canMove()) {
      clearSave();
      startRun();
      return;
    }
    ensureAudio();
    running = true;
    paused = false;
    lastTs = 0;
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    loop();
  }

  function goHome() {
    if (running && canMove()) writeSave();
    stopLoop();
    updateMenu();
    navigateTo("home");
  }

  function pauseRun() {
    if (!running || paused) return;
    paused = true;
    writeSave();
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
    clearSave();
    if (score > best) {
      best = score;
      writeBest(best);
      updateBestReadout();
    }
    stopLoop();
    updateMenu();
    if (overStats) {
      overStats.innerHTML = "SCORE " + pad(score, 5) + "<br>BEST " + pad(best, 5);
    }
    navigateTo("over");
  }

  function tileColor(v) {
    if (TILE[v]) return TILE[v];
    return "#B388FF";
  }

  function tileFont(v) {
    if (v >= 10000) return "700 18px ui-monospace, monospace";
    if (v >= 1000) return "700 22px ui-monospace, monospace";
    return "700 28px ui-monospace, monospace";
  }

  function draw() {
    ctx.clearRect(0, 0, 600, 600);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(OX - 10, OY - 10, BOARD + 20, BOARD + 20);

    var r;
    var c;
    for (r = 0; r < GRID; r += 1) {
      for (c = 0; c < GRID; c += 1) {
        var x = OX + c * (CELL + GAP);
        var y = OY + r * (CELL + GAP);
        var v = board[r][c];
        ctx.fillStyle = v ? tileColor(v) : LINE;
        ctx.fillRect(x, y, CELL, CELL);
        if (v) {
          ctx.fillStyle = v >= 2048 && v < 4096 ? "#1C1E21" : CREAM;
          ctx.font = tileFont(v);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(v), x + CELL / 2, y + CELL / 2 + 1);
        }
      }
    }

    ctx.fillStyle = SURFACE;
    ctx.fillRect(16, 16, 568, 44);
    ctx.fillStyle = CREAM;
    ctx.font = "700 18px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("SCORE " + pad(score, 5), 28, 45);
    ctx.textAlign = "right";
    ctx.fillStyle = AMBER;
    ctx.fillText("UNDO " + undos, 572, 45);

    if (hintT > 0) {
      ctx.globalAlpha = Math.min(1, hintT / 0.6);
      ctx.fillStyle = SURFACE;
      ctx.fillRect(16, 548, 568, 36);
      ctx.fillStyle = MUTED;
      ctx.font = "700 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("SWIPE TO SLIDE  ·  PINCH UNDO", 300, 572);
      ctx.globalAlpha = 1;
    }
  }

  function update(dt) {
    if (hintT > 0) hintT -= dt;
    spawnT -= dt;
    if (spawnT <= 0) {
      spawnN(idleSpawnCount());
      spawnT = spawnInterval();
      writeSave();
      if (!canMove()) {
        draw();
        endRun();
        return;
      }
    }
  }

  function loop(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (paused) {
      draw();
      return;
    }
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
    if (event.repeat) return;
    if (key === "enter") undo();
    else if (key === "up" || key === "down" || key === "left" || key === "right") slide(key);
    focusPlay();
  }

  function handleAction(action) {
    if (action === "continue") continueRun();
    else if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") goHome();
    else if (action === "resume") resumeRun();
    else if (action === "undo") undo();
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
        else if (currentScreen !== "home") goHome();
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

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && running && canMove()) writeSave();
  });

  window.addEventListener("pagehide", function () {
    if (running && canMove()) writeSave();
  });

  collectScreens();
  best = readBest();
  updateBestReadout();
  updateMenu();
  focusFirst(screens.home);
})();
