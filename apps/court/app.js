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

  var MAX = 12;
  var START = 6;
  var BEST_KEY = "court-best";
  var KEYS = ["faith", "folk", "arms", "coin"];
  var LABELS = { faith: "FAITH", folk: "FOLK", arms: "ARMS", coin: "COIN" };

  var DECK = [
    {
      id: "harvest",
      who: "STEWARD",
      say: "The harvest is late. Open the royal granaries?",
      L: { label: "KEEP", folk: -2, coin: 1 },
      R: { label: "OPEN", folk: 3, coin: -2 },
    },
    {
      id: "tithe",
      who: "BISHOP",
      say: "Double the tithe. Heaven is not cheap this year.",
      L: { label: "REFUSE", faith: -3, folk: 1 },
      R: { label: "DOUBLE", faith: 3, folk: -2, coin: 1 },
    },
    {
      id: "raid",
      who: "CAPTAIN",
      say: "A border raid would teach the east some manners.",
      L: { label: "HOLD", arms: -1, folk: 1 },
      R: { label: "RAID", arms: 2, folk: -1, coin: 2, next: "raid-loot" },
    },
    {
      id: "raid-loot",
      who: "CAPTAIN",
      say: "The raid brought cattle. Share them with the villages?",
      follow: true,
      L: { label: "KEEP", folk: -2, coin: 2, arms: 1 },
      R: { label: "SHARE", folk: 3, coin: -1 },
    },
    {
      id: "bridge",
      who: "MASON",
      say: "The old bridge groans. Rebuild it in stone?",
      L: { label: "PATCH", folk: -1, coin: 1 },
      R: { label: "STONE", folk: 2, coin: -3, arms: 1 },
    },
    {
      id: "feast",
      who: "STEWARD",
      say: "The court wants a three-day feast. The cellar disagrees.",
      L: { label: "FAST", folk: -2, coin: 2, faith: 1 },
      R: { label: "FEAST", folk: 2, coin: -3, faith: -1 },
    },
    {
      id: "heretic",
      who: "BISHOP",
      say: "A scholar calls the stars older than scripture. Burn the book?",
      L: { label: "SPARE", faith: -3, folk: 1 },
      R: { label: "BURN", faith: 3, folk: -2 },
    },
    {
      id: "levy",
      who: "CAPTAIN",
      say: "We need a new levy. Farmhands make poor soldiers, but they fill a line.",
      L: { label: "NO", arms: -2, folk: 1 },
      R: { label: "LEVY", arms: 3, folk: -3 },
    },
    {
      id: "loan",
      who: "MERCHANT",
      say: "Lend me a fleet's worth of coin. I return it doubled. Probably.",
      L: { label: "REFUSE", coin: 1, folk: -1 },
      R: { label: "LEND", coin: -3, next: "loan-back" },
    },
    {
      id: "loan-back",
      who: "MERCHANT",
      say: "The fleet returned. I can pay you now, or fund a cathedral instead.",
      follow: true,
      L: { label: "PAY", coin: 5, faith: -1 },
      R: { label: "CHURCH", faith: 4, coin: 1, folk: 1 },
    },
    {
      id: "plague",
      who: "PHYSICIAN",
      say: "Fever in the lower city. Seal the gates?",
      L: { label: "OPEN", folk: -3, coin: -1, arms: -1 },
      R: { label: "SEAL", folk: -1, coin: -2, faith: 1, arms: 1 },
    },
    {
      id: "spy",
      who: "SPY",
      say: "The west is massing horses. Pay for a second look?",
      L: { label: "IGNORE", arms: -2 },
      R: { label: "PAY", coin: -2, arms: 2 },
    },
    {
      id: "hunt",
      who: "HUNTSMAN",
      say: "A white stag in the king's wood. Hunt it, or let the stories grow?",
      L: { label: "SPARE", faith: 2, folk: 1, coin: -1 },
      R: { label: "HUNT", folk: 2, faith: -2, coin: 1 },
    },
    {
      id: "envoy",
      who: "ENVOY",
      say: "The south offers a marriage treaty. Your cousin is available. Barely.",
      L: { label: "REFUSE", arms: -1, folk: 1 },
      R: { label: "WED", arms: 2, faith: 1, coin: -1, folk: -1, next: "wedding" },
    },
    {
      id: "wedding",
      who: "STEWARD",
      say: "The wedding needs fireworks, or the south will call us cheap.",
      follow: true,
      L: { label: "PLAIN", folk: -1, coin: 1, arms: -1 },
      R: { label: "SHOW", folk: 2, coin: -3, arms: 1 },
    },
    {
      id: "jester",
      who: "JESTER",
      say: "I wrote a song about your nose. Shall I sing it in the square?",
      L: { label: "SILENCE", folk: -2, coin: 1 },
      R: { label: "SING", folk: 3, faith: -1 },
    },
    {
      id: "tax",
      who: "STEWARD",
      say: "The salt tax is overdue. Collect it hard?",
      L: { label: "SOFT", coin: -2, folk: 2 },
      R: { label: "HARD", coin: 3, folk: -3 },
    },
    {
      id: "abbey",
      who: "BISHOP",
      say: "Found an abbey on the ridge. The monks will pray at you.",
      L: { label: "NO", faith: -2, coin: 1 },
      R: { label: "FOUND", faith: 3, coin: -3, folk: 1 },
    },
    {
      id: "deserter",
      who: "CAPTAIN",
      say: "A deserter came home. Hang him as an example?",
      L: { label: "SPARE", arms: -2, folk: 2, faith: 1 },
      R: { label: "HANG", arms: 3, folk: -2, faith: -1 },
    },
    {
      id: "famine-seed",
      who: "FARMER",
      say: "We need seed grain, not more banners.",
      L: { label: "BANNERS", arms: 2, folk: -2, coin: -1 },
      R: { label: "SEED", folk: 3, coin: -2, arms: -1 },
    },
    {
      id: "relic",
      who: "BISHOP",
      say: "A merchant sells a saint's finger. Obviously genuine.",
      L: { label: "PASS", faith: -1, coin: 1 },
      R: { label: "BUY", faith: 2, coin: -2, folk: 1 },
    },
    {
      id: "wall",
      who: "MASON",
      say: "Raise the north wall before winter. Or raise a toast instead.",
      L: { label: "TOAST", arms: -2, folk: 1, coin: 1 },
      R: { label: "WALL", arms: 3, coin: -3, folk: -1 },
    },
    {
      id: "poet",
      who: "SCHOLAR",
      say: "Fund a chronicle of your reign. History is expensive, and flattering.",
      L: { label: "NO", folk: -1, coin: 1 },
      R: { label: "FUND", folk: 2, coin: -2, faith: -1 },
    },
    {
      id: "bandits",
      who: "GUARD",
      say: "Bandits on the high road. Send the army, or pay them off?",
      L: { label: "PAY", coin: -3, folk: 1, arms: -1 },
      R: { label: "HUNT", arms: 2, coin: -1, folk: 2 },
    },
    {
      id: "fast-day",
      who: "BISHOP",
      say: "Declare a month of fasting. The kitchens will riot.",
      L: { label: "FEAST", faith: -3, folk: 2, coin: -1 },
      R: { label: "FAST", faith: 3, folk: -2, coin: 1 },
    },
    {
      id: "tournament",
      who: "CAPTAIN",
      say: "A tournament would keep the knights from inventing wars.",
      L: { label: "SKIP", arms: -1, coin: 1 },
      R: { label: "HOLD", arms: 2, folk: 2, coin: -3, next: "tourney-hurt" },
    },
    {
      id: "tourney-hurt",
      who: "PHYSICIAN",
      say: "Your champion is broken. Pay the physician, or pray?",
      follow: true,
      L: { label: "PRAY", faith: 2, arms: -2 },
      R: { label: "PAY", coin: -2, arms: 1, folk: 1 },
    },
    {
      id: "harbor",
      who: "MERCHANT",
      say: "Dredge the harbor. Trade follows deep water.",
      L: { label: "SILT", coin: -1, folk: -1 },
      R: { label: "DREDGE", coin: 3, folk: 1, arms: -1, faith: -1 },
    },
    {
      id: "witch",
      who: "WIDOW",
      say: "They call me a witch because the well went dry. Speak for me?",
      L: { label: "CROWD", faith: 2, folk: -2 },
      R: { label: "SHIELD", folk: 2, faith: -3 },
    },
    {
      id: "heir",
      who: "HEIR",
      say: "Give me a command on the border. I am bored of maps.",
      L: { label: "MAPS", arms: -1, folk: 1 },
      R: { label: "RIDE", arms: 2, folk: -1, next: "heir-letter" },
    },
    {
      id: "heir-letter",
      who: "SPY",
      say: "A letter from the border: the heir is popular. Too popular.",
      follow: true,
      L: { label: "IGNORE", arms: -2, folk: 1 },
      R: { label: "RECALL", arms: 1, folk: -2, coin: -1 },
    },
    {
      id: "mint",
      who: "STEWARD",
      say: "Debase the coin. More coins, less silver, fewer questions.",
      L: { label: "PURE", coin: -1, folk: 1, faith: 1 },
      R: { label: "CUT", coin: 3, folk: -2, faith: -2 },
    },
    {
      id: "pardon",
      who: "DIPLOMAT",
      say: "Pardon the exiled duke. He has friends, and a memory.",
      L: { label: "EXILE", arms: 1, folk: -1, faith: -1 },
      R: { label: "PARDON", folk: 2, arms: -2, faith: 1 },
    },
    {
      id: "forest",
      who: "HUNTSMAN",
      say: "Sell the oak wood to the shipwrights?",
      L: { label: "KEEP", faith: 1, coin: -1, arms: -1 },
      R: { label: "SELL", coin: 3, faith: -1, folk: -1 },
    },
    {
      id: "orphan",
      who: "WIDOW",
      say: "The war left forty orphans. A house, or the streets?",
      L: { label: "STREET", folk: -3, coin: 1, faith: -1 },
      R: { label: "HOUSE", folk: 3, coin: -2, faith: 2 },
    },
    {
      id: "cannon",
      who: "CAPTAIN",
      say: "Buy three loud guns from the south. The walls will notice.",
      L: { label: "NO", arms: -1, coin: 1 },
      R: { label: "BUY", arms: 3, coin: -3, folk: -1 },
    },
    {
      id: "sermon",
      who: "BISHOP",
      say: "Preach from the balcony this Sunday. Be seen believing.",
      L: { label: "SKIP", faith: -2, folk: 1 },
      R: { label: "PREACH", faith: 3, folk: 1, arms: -1 },
    },
    {
      id: "flood",
      who: "FARMER",
      say: "The river took two villages. Send grain, or send priests?",
      L: { label: "PRIESTS", faith: 3, folk: -2 },
      R: { label: "GRAIN", folk: 3, coin: -2, faith: -1 },
    },
    {
      id: "duel",
      who: "GUARD",
      say: "Two nobles want a duel in the courtyard. Allow it?",
      L: { label: "BAN", arms: -1, faith: 1, folk: 1 },
      R: { label: "ALLOW", arms: 2, folk: 1, faith: -2 },
    },
    {
      id: "map",
      who: "SCHOLAR",
      say: "A new map puts our mines in their country. Redraw it?",
      L: { label: "TRUTH", coin: -2, faith: 1, arms: -1 },
      R: { label: "INK", coin: 2, arms: 1, faith: -2 },
    },
    {
      id: "ale",
      who: "STEWARD",
      say: "Cheap ale for the city. They will love you until morning.",
      L: { label: "WATER", folk: -2, coin: 1, faith: 1 },
      R: { label: "ALE", folk: 3, coin: -2, faith: -1, arms: -1 },
    },
    {
      id: "spy-west",
      who: "SPY",
      say: "Plant a rumor that their king is ill. Cheap, unkind, useful.",
      L: { label: "HONOR", faith: 2, arms: -1 },
      R: { label: "RUMOR", arms: 2, faith: -2, coin: -1 },
    },
    {
      id: "statue",
      who: "MASON",
      say: "A statue of you in the square. Slightly taller than life.",
      L: { label: "NO", folk: 1, coin: 1 },
      R: { label: "CARVE", folk: -2, coin: -2, faith: -1, arms: 1 },
    },
    {
      id: "pilgrim",
      who: "ENVOY",
      say: "Pilgrims want a road through the hunting park.",
      L: { label: "PARK", faith: -2, folk: -1, coin: 1 },
      R: { label: "ROAD", faith: 3, folk: 2, coin: -2, arms: -1 },
    },
    {
      id: "mutiny",
      who: "CAPTAIN",
      say: "The garrison wants double pay or they walk.",
      L: { label: "WALK", arms: -3, coin: 2, folk: -1 },
      R: { label: "PAY", arms: 2, coin: -3, folk: 1 },
    },
    {
      id: "comet",
      who: "SCHOLAR",
      say: "A comet. The bishop wants a week of prayer. I want a tower.",
      L: { label: "PRAY", faith: 3, coin: -1, folk: 1 },
      R: { label: "TOWER", faith: -2, coin: -2, folk: 1, arms: 1 },
    },
    {
      id: "grain-export",
      who: "MERCHANT",
      say: "Sell surplus grain abroad. Our people can eat next year.",
      L: { label: "STORE", folk: 2, coin: -1 },
      R: { label: "SELL", coin: 3, folk: -3 },
    },
    {
      id: "confession",
      who: "BISHOP",
      say: "Confess in public. The court would enjoy it more than Heaven.",
      L: { label: "PRIVATE", faith: -1, folk: 1 },
      R: { label: "PUBLIC", faith: 2, folk: 2, arms: -2 },
    },
    {
      id: "scout",
      who: "HUNTSMAN",
      say: "Scout the marsh for a summer camp. Mosquitoes included.",
      L: { label: "HOME", arms: -1, coin: 1 },
      R: { label: "CAMP", arms: 2, coin: -1, folk: -1 },
    },
    {
      id: "bell",
      who: "MASON",
      say: "A new bell for the cathedral. It will be very loud about your piety.",
      L: { label: "QUIET", faith: -2, coin: 1 },
      R: { label: "BELL", faith: 3, coin: -2, folk: 1 },
    },
  ];

  var byId = {};
  DECK.forEach(function (card) {
    byId[card.id] = card;
  });

  var screens = {};
  var currentScreen = "home";
  var playBtn = document.getElementById("play-btn");
  var pauseOverlay = document.getElementById("pause-overlay");
  var bestReadout = document.getElementById("best-readout");
  var overStats = document.getElementById("over-stats");
  var overCause = document.getElementById("over-cause");
  var metersEl = document.getElementById("meters");
  var whoEl = document.getElementById("who");
  var sayEl = document.getElementById("say");
  var leftEl = document.getElementById("left-label");
  var rightEl = document.getElementById("right-label");
  var yearEl = document.getElementById("year-readout");

  var running = false;
  var paused = false;
  var stats = emptyStats();
  var years = 0;
  var best = 0;
  var card = null;
  var recent = [];
  var queued = "";

  function emptyStats() {
    return { faith: START, folk: START, arms: START, coin: START };
  }

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
    if (bestReadout) bestReadout.textContent = "BEST " + pad(best, 2) + " YR";
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

  function focusPlay() {
    if (playBtn) playBtn.focus();
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

  function affected(choice) {
    var marks = {};
    KEYS.forEach(function (key) {
      marks[key] = !!(choice && choice[key]);
    });
    return marks;
  }

  function renderMeters() {
    var leftMarks = affected(card && card.L);
    var rightMarks = affected(card && card.R);
    metersEl.innerHTML = KEYS.map(function (key) {
      var value = stats[key];
      var hot = value <= 2 || value >= 10;
      var hinted = leftMarks[key] || rightMarks[key];
      var pct = Math.round((value / MAX) * 100);
      return (
        '<div class="meter ' +
        key +
        (hot ? " hot" : "") +
        '">' +
        '<span class="meter-name">' +
        LABELS[key] +
        "</span>" +
        '<span class="hint' +
        (hinted ? " on" : "") +
        '"></span>' +
        '<div class="bar"><div class="fill" style="height:' +
        pct +
        '%"></div></div>' +
        "</div>"
      );
    }).join("");
  }

  function renderCard() {
    if (!card) return;
    whoEl.textContent = card.who;
    sayEl.textContent = card.say;
    leftEl.innerHTML = '<span class="dir">L</span> ' + card.L.label;
    rightEl.innerHTML = '<span class="dir">R</span> ' + card.R.label;
    yearEl.textContent = "YEAR " + pad(years, 2);
    renderMeters();
  }

  function pickCard() {
    if (queued && byId[queued]) {
      var follow = byId[queued];
      queued = "";
      return follow;
    }
    var pool = DECK.filter(function (item) {
      return !item.follow && recent.indexOf(item.id) === -1;
    });
    if (!pool.length) {
      pool = DECK.filter(function (item) {
        return !item.follow;
      });
    }
    var pick = pool[(Math.random() * pool.length) | 0];
    recent.push(pick.id);
    if (recent.length > 8) recent.shift();
    return pick;
  }

  function deathCause() {
    if (stats.faith <= 0) return "The clergy name you heretic. The pyre is already stacked.";
    if (stats.faith >= MAX) return "A holy frenzy fills the streets. They carry you into the cathedral. You do not come back.";
    if (stats.folk <= 0) return "The gates fall from inside. Pitchforks, then silence.";
    if (stats.folk >= MAX) return "A grateful crush of gifts. You disappear under bread and flowers.";
    if (stats.arms <= 0) return "The border is a rumor. Their banners are already in the square.";
    if (stats.arms >= MAX) return "The captains decide you are safer in a tower. The key is lost.";
    if (stats.coin <= 0) return "The lenders take the palace. You leave with a spoon.";
    if (stats.coin >= MAX) return "The gold coach is too heavy. The bridge agrees.";
    return "The reign ends.";
  }

  function endReign() {
    running = false;
    paused = false;
    pauseOverlay.classList.add("hidden");
    if (years > best) {
      best = years;
      writeBest(best);
      updateBestReadout();
    }
    if (overStats) {
      overStats.innerHTML = "YEAR " + pad(years, 2) + "<br>BEST " + pad(best, 2);
    }
    if (overCause) overCause.textContent = deathCause();
    navigateTo("over");
  }

  function applyChoice(side) {
    if (!running || paused || !card) return;
    var choice = side === "left" ? card.L : card.R;
    KEYS.forEach(function (key) {
      var delta = choice[key] || 0;
      stats[key] = Math.max(0, Math.min(MAX, stats[key] + delta));
    });
    years += 1;
    var dead = KEYS.some(function (key) {
      return stats[key] <= 0 || stats[key] >= MAX;
    });
    if (dead) {
      renderMeters();
      endReign();
      return;
    }
    queued = choice.next || "";
    card = pickCard();
    renderCard();
  }

  function startRun() {
    running = true;
    paused = false;
    stats = emptyStats();
    years = 0;
    recent = [];
    queued = "";
    card = pickCard();
    pauseOverlay.classList.add("hidden");
    navigateTo("play");
    renderCard();
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

  function stopRun() {
    running = false;
    paused = false;
    pauseOverlay.classList.add("hidden");
  }

  function handlePlayKey(event) {
    var key = playKey(event);
    if (key === "escape") {
      pauseRun();
      return;
    }
    if (key === "enter") {
      focusPlay();
      return;
    }
    if (event.repeat) return;
    if (key === "left" || key === "up") applyChoice("left");
    if (key === "right" || key === "down") applyChoice("right");
    focusPlay();
  }

  function handleAction(action) {
    if (action === "play" || action === "again") startRun();
    else if (action === "how") navigateTo("how");
    else if (action === "home" || action === "quit") {
      stopRun();
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
          stopRun();
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
