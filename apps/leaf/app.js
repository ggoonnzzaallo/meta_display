(function () {
  "use strict";

  var API_URL = "https://yvbirjzcrlnnzwdrntxp.supabase.co/functions/v1/leaf";
  var DEVICE_KEY = "leaf-device-v1";
  var FONT_KEY = "leaf-font-v1";
  var DB_NAME = "leaf-reader-v1";
  var DB_STORE = "books";
  var BUILD = "v1";
  var FONT_SIZES = [23, 26, 28, 31, 34];

  var DEMO_BOOK = {
    id: "leaf-demo-book",
    title: "A Small Book of Mornings",
    author: "Leaf Demo",
    created_at: "2026-08-25T00:00:00Z",
    chapters: [
      {
        id: "welcome",
        title: "The First Page",
        text: "A book on the glasses should feel less like a website and more like a quiet pane of thought. The controls disappear. The words stay. A page arrives with just enough ceremony to make moving forward feel good.\n\nPress right to turn the page. Press left to return. Pinch or press Enter when you want the controls. Your position is remembered after every turn.",
      },
      {
        id: "walking",
        title: "Reading in Motion",
        text: "Short pages make room for the world around them. Nothing scrolls under your eye, and nothing asks you to chase a moving line. Each gesture advances one deliberate piece of the chapter.\n\nThe reader stores a text anchor rather than a fragile page number. Change the type size and Leaf will rebuild the page around the same passage.",
      },
      {
        id: "returning",
        title: "The Return",
        text: "The most important page turn is the one that happens tomorrow. Open the book again and it should return without negotiation: same chapter, same passage, same comfortable type.\n\nThat is the promise of Leaf. Your book waits where you left it.",
      },
    ],
  };

  var screens = {};
  var currentScreen = "home";
  var books = [];
  var currentBook = null;
  var chapterIndex = 0;
  var pageStart = 0;
  var pageEnd = 0;
  var fontIndex = 2;
  var pageCache = {};
  var turning = false;
  var controlsOpen = false;
  var pairTimer = 0;
  var saveTimer = 0;
  var hudTimer = 0;
  var toastTimer = 0;
  var audioContext = null;

  var libraryEl = document.getElementById("library");
  var tocList = document.getElementById("toc-list");
  var pageStage = document.getElementById("page-stage");
  var pageCurrent = document.getElementById("page-current");
  var pageOld = document.getElementById("page-old");
  var measure = document.getElementById("measure");
  var readerHud = document.getElementById("reader-hud");
  var readerControls = document.getElementById("reader-controls");
  var chapterLabel = document.getElementById("chapter-label");
  var progressLabel = document.getElementById("progress-label");
  var pairCode = document.getElementById("pair-code");
  var pairMessage = document.getElementById("pair-message");
  var pairState = document.getElementById("pair-state");
  var toast = document.getElementById("toast");

  function randomToken() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function deviceToken() {
    var token = localStorage.getItem(DEVICE_KEY);
    if (!token || token.length < 40) {
      token = randomToken();
      localStorage.setItem(DEVICE_KEY, token);
    }
    return token;
  }

  function progressKey(bookId) {
    return "leaf-progress-v1:" + bookId;
  }

  function getLocalProgress(bookId) {
    try {
      return JSON.parse(localStorage.getItem(progressKey(bookId)) || "null");
    } catch (error) {
      return null;
    }
  }

  function setLocalProgress(bookId, value) {
    localStorage.setItem(progressKey(bookId), JSON.stringify(value));
  }

  function api(action, data) {
    var payload = Object.assign({ action: action }, data || {});
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (body) {
        if (!response.ok) throw new Error(body.error || "Leaf service unavailable");
        return body;
      });
    });
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function dbRequest(mode, operation) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, mode);
        var store = tx.objectStore(DB_STORE);
        var request = operation(store);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
        tx.oncomplete = function () { db.close(); };
      });
    });
  }

  function cacheBook(book) {
    return dbRequest("readwrite", function (store) { return store.put(book); });
  }

  function cachedBooks() {
    return dbRequest("readonly", function (store) { return store.getAll(); }).catch(function () {
      return [];
    });
  }

  function cachedBook(id) {
    return dbRequest("readonly", function (store) { return store.get(id); }).catch(function () {
      return null;
    });
  }

  function collectScreens() {
    document.querySelectorAll(".screen, .reader-screen").forEach(function (screen) {
      if (screen.id) screens[screen.id] = screen;
    });
  }

  function navigateTo(id) {
    Object.keys(screens).forEach(function (key) { screens[key].classList.add("hidden"); });
    if (!screens[id]) return;
    screens[id].classList.remove("hidden");
    currentScreen = id;
    if (id !== "pair") stopPairPolling();
    if (id !== "reader") closeControls();
    var first = screens[id].querySelector(".focusable:not([disabled])");
    if (first) first.focus();
  }

  function visibleFocusables() {
    var root = screens[currentScreen];
    if (!root) return [];
    return Array.from(root.querySelectorAll(".focusable:not([disabled]):not(.hidden)"));
  }

  function moveFocus(direction) {
    var focusables = visibleFocusables();
    if (!focusables.length) return;
    var index = focusables.indexOf(document.activeElement);
    if (index < 0) index = 0;
    else if (direction === "up" || direction === "left") index = (index - 1 + focusables.length) % focusables.length;
    else index = (index + 1) % focusables.length;
    focusables[index].focus();
    focusables[index].scrollIntoView({ block: "nearest" });
  }

  function activateFocused() {
    var active = document.activeElement;
    if (active && active.classList.contains("focusable")) active.click();
  }

  function bookPercent(book, progress) {
    if (!progress || !book.chapters || !book.chapters.length) return 0;
    var total = 0;
    var read = 0;
    book.chapters.forEach(function (chapter, index) {
      var length = (chapter.text || "").length;
      total += length;
      if (index < progress.chapter_index) read += length;
      if (index === progress.chapter_index) read += Math.min(length, progress.anchor || 0);
    });
    return total ? Math.round((read / total) * 100) : 0;
  }

  function renderLibrary() {
    libraryEl.innerHTML = "";
    if (!books.length) {
      var empty = document.createElement("div");
      empty.className = "empty-library";
      empty.innerHTML = "<strong>Your shelf is quiet.</strong><span>Add an EPUB from a phone or computer, then it will appear here.</span>";
      libraryEl.appendChild(empty);
      return;
    }
    books.forEach(function (book) {
      var progress = getLocalProgress(book.id) || book.progress || null;
      var button = document.createElement("button");
      button.className = "focusable book-button";
      button.dataset.bookId = book.id;
      var title = document.createElement("span");
      title.className = "book-title";
      title.textContent = book.title || "Untitled";
      var author = document.createElement("span");
      author.className = "book-author";
      author.textContent = book.author || "Unknown author";
      var pct = document.createElement("span");
      pct.className = "book-progress";
      pct.textContent = bookPercent(book, progress) + "%";
      button.appendChild(title);
      button.appendChild(author);
      button.appendChild(pct);
      libraryEl.appendChild(button);
    });
  }

  function mergeBooks(local, remote) {
    var map = {};
    local.concat(remote || []).forEach(function (book) {
      if (!book || !book.id) return;
      map[book.id] = Object.assign(map[book.id] || {}, book);
    });
    books = Object.keys(map).map(function (id) { return map[id]; });
    books.sort(function (a, b) { return String(b.created_at || "").localeCompare(String(a.created_at || "")); });
    renderLibrary();
  }

  function refreshLibrary() {
    return cachedBooks().then(function (local) {
      mergeBooks(local, []);
      return api("library", { device_token: deviceToken() }).then(function (result) {
        var remote = result.books || [];
        mergeBooks(local, remote);
        return remote;
      }).catch(function () {
        return [];
      });
    });
  }

  function startPairing() {
    navigateTo("pair");
    pairCode.textContent = "•••• ••••";
    pairMessage.textContent = "Creating a ten-minute pairing code…";
    pairState.textContent = "CONNECT";
    api("create_pair", { device_token: deviceToken() }).then(function (result) {
      pairCode.textContent = result.code.slice(0, 4) + " " + result.code.slice(4);
      pairMessage.textContent = "Waiting for your EPUB. This code expires in ten minutes.";
      pairState.textContent = "WAITING";
      startPairPolling();
    }).catch(function (error) {
      pairState.textContent = "OFFLINE";
      pairMessage.textContent = error.message;
    });
  }

  function startPairPolling() {
    stopPairPolling();
    pairTimer = window.setInterval(checkPair, 2500);
  }

  function stopPairPolling() {
    if (pairTimer) window.clearInterval(pairTimer);
    pairTimer = 0;
  }

  function checkPair() {
    api("pair_status", { device_token: deviceToken() }).then(function (result) {
      if (!result.ready || !result.book_id) return;
      stopPairPolling();
      pairState.textContent = "READY";
      pairMessage.textContent = "Book received. Opening…";
      return downloadAndOpen(result.book_id);
    }).catch(function () {});
  }

  function loadBook(id) {
    if (id === DEMO_BOOK.id) return Promise.resolve(DEMO_BOOK);
    return cachedBook(id).then(function (local) {
      if (local && local.chapters && local.chapters.length) return local;
      return api("get_book", { device_token: deviceToken(), book_id: id }).then(function (result) {
        return result.book;
      });
    });
  }

  function downloadAndOpen(id) {
    return api("get_book", { device_token: deviceToken(), book_id: id }).then(function (result) {
      return cacheBook(result.book).then(function () {
        mergeBooks(books, [result.book]);
        return openBook(result.book);
      });
    }).catch(function (error) {
      showToast(error.message);
      navigateTo("home");
    });
  }

  function openBook(book) {
    currentBook = book;
    pageCache = {};
    var progress = getLocalProgress(book.id) || book.progress || {};
    chapterIndex = clamp(Number(progress.chapter_index) || 0, 0, book.chapters.length - 1);
    pageStart = Math.max(0, Number(progress.anchor) || 0);
    if (Number.isFinite(Number(progress.font_size))) {
      var savedIndex = FONT_SIZES.indexOf(Number(progress.font_size));
      if (savedIndex >= 0) fontIndex = savedIndex;
    }
    applyFont();
    navigateTo("reader");
    resolvePageAt(pageStart);
    renderPage(false);
    pageCurrent.focus();
    showHud();
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function chapterText(index) {
    return String((currentBook.chapters[index] || {}).text || "").trim();
  }

  function cacheKey(index) {
    return currentBook.id + ":" + FONT_SIZES[fontIndex] + ":" + index;
  }

  function startsFor(index) {
    var key = cacheKey(index);
    if (!pageCache[key]) pageCache[key] = [0];
    return pageCache[key];
  }

  function fits(text) {
    measure.textContent = text;
    return measure.scrollHeight <= measure.clientHeight + 1;
  }

  function fitEnd(text, start) {
    start = Math.min(start, text.length);
    while (start < text.length && /\s/.test(text.charAt(start))) start += 1;
    if (start >= text.length) return text.length;
    var low = Math.min(text.length, start + 1);
    var high = Math.min(text.length, start + 2400);
    while (high < text.length && fits(text.slice(start, high))) {
      low = high;
      high = Math.min(text.length, high + 1800);
    }
    while (low < high) {
      var middle = Math.ceil((low + high) / 2);
      if (fits(text.slice(start, middle))) low = middle;
      else high = middle - 1;
    }
    var end = low;
    if (end < text.length) {
      var paragraph = text.lastIndexOf("\n", end);
      var word = text.lastIndexOf(" ", end);
      var breakAt = Math.max(paragraph, word);
      if (breakAt > start + Math.min(120, (end - start) * 0.45)) end = breakAt;
    }
    return Math.max(start + 1, end);
  }

  function buildStartsThrough(index, target) {
    var text = chapterText(index);
    var starts = startsFor(index);
    while (starts[starts.length - 1] < target && starts[starts.length - 1] < text.length) {
      var next = fitEnd(text, starts[starts.length - 1]);
      if (next <= starts[starts.length - 1]) break;
      starts.push(next);
    }
    return starts;
  }

  function resolvePageAt(anchor) {
    var text = chapterText(chapterIndex);
    if (!text) {
      pageStart = 0;
      pageEnd = 0;
      return;
    }
    anchor = clamp(anchor, 0, Math.max(0, text.length - 1));
    var starts = buildStartsThrough(chapterIndex, anchor);
    pageStart = 0;
    starts.forEach(function (start) {
      if (start <= anchor) pageStart = start;
    });
    pageEnd = fitEnd(text, pageStart);
    if (starts.indexOf(pageEnd) < 0 && pageEnd < text.length) starts.push(pageEnd);
  }

  function currentPageText() {
    return chapterText(chapterIndex).slice(pageStart, pageEnd).trim();
  }

  function progressPercent() {
    var total = 0;
    var read = 0;
    currentBook.chapters.forEach(function (chapter, index) {
      var length = String(chapter.text || "").length;
      total += length;
      if (index < chapterIndex) read += length;
      if (index === chapterIndex) read += pageStart;
    });
    return total ? Math.round((read / total) * 100) : 0;
  }

  function renderPage(animate, direction) {
    var nextText = currentPageText();
    if (animate) {
      pageOld.textContent = pageCurrent.textContent;
      pageStage.classList.remove("turn-next", "turn-prev");
      void pageStage.offsetWidth;
      pageStage.classList.add(direction === "prev" ? "turn-prev" : "turn-next");
      turning = true;
      window.setTimeout(function () {
        pageStage.classList.remove("turn-next", "turn-prev");
        turning = false;
      }, 235);
    }
    pageCurrent.textContent = nextText || "End of chapter";
    var chapter = currentBook.chapters[chapterIndex];
    chapterLabel.textContent = String(chapter.title || "Chapter " + (chapterIndex + 1)).toUpperCase();
    progressLabel.textContent = progressPercent() + "%";
    saveProgress();
    showHud();
  }

  function nextPage() {
    if (!currentBook || turning) return;
    var text = chapterText(chapterIndex);
    tick(1);
    if (pageEnd < text.length) {
      pageStart = pageEnd;
      pageEnd = fitEnd(text, pageStart);
      var starts = startsFor(chapterIndex);
      if (starts.indexOf(pageStart) < 0) starts.push(pageStart);
      renderPage(true, "next");
      return;
    }
    if (chapterIndex < currentBook.chapters.length - 1) {
      chapterIndex += 1;
      pageStart = 0;
      resolvePageAt(0);
      renderPage(true, "next");
      showToast("Chapter " + (chapterIndex + 1));
      tick(2);
      return;
    }
    showToast("Book complete");
    tick(3);
  }

  function previousPage() {
    if (!currentBook || turning) return;
    tick(1);
    if (pageStart > 0) {
      var starts = buildStartsThrough(chapterIndex, pageStart);
      var previous = 0;
      starts.forEach(function (start) { if (start < pageStart) previous = start; });
      pageStart = previous;
      pageEnd = fitEnd(chapterText(chapterIndex), pageStart);
      renderPage(true, "prev");
      return;
    }
    if (chapterIndex > 0) {
      chapterIndex -= 1;
      var text = chapterText(chapterIndex);
      var starts = buildStartsThrough(chapterIndex, text.length);
      pageStart = starts[starts.length - 1];
      if (pageStart >= text.length && starts.length > 1) pageStart = starts[starts.length - 2];
      pageEnd = fitEnd(text, pageStart);
      renderPage(true, "prev");
    }
  }

  function progressObject() {
    return {
      chapter_index: chapterIndex,
      anchor: pageStart,
      font_size: FONT_SIZES[fontIndex],
      updated_at: new Date().toISOString(),
    };
  }

  function saveProgress() {
    if (!currentBook) return;
    var progress = progressObject();
    setLocalProgress(currentBook.id, progress);
    currentBook.progress = progress;
    if (currentBook.id === DEMO_BOOK.id) return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      api("save_progress", {
        device_token: deviceToken(),
        book_id: currentBook.id,
        progress: progress,
      }).catch(function () {});
    }, 700);
  }

  function applyFont() {
    var size = FONT_SIZES[fontIndex];
    document.documentElement.style.setProperty("--page-font", size + "px");
    localStorage.setItem(FONT_KEY, String(size));
  }

  function changeFont(delta) {
    var anchor = pageStart;
    fontIndex = clamp(fontIndex + delta, 0, FONT_SIZES.length - 1);
    applyFont();
    pageCache = {};
    resolvePageAt(anchor);
    renderPage(false);
    showToast(FONT_SIZES[fontIndex] + "px type");
  }

  function renderToc() {
    tocList.innerHTML = "";
    currentBook.chapters.forEach(function (chapter, index) {
      var button = document.createElement("button");
      button.className = "focusable";
      button.dataset.chapter = String(index);
      var number = document.createElement("span");
      number.className = "toc-index";
      number.textContent = String(index + 1).padStart(2, "0");
      button.appendChild(number);
      button.appendChild(document.createTextNode(chapter.title || "Chapter " + (index + 1)));
      tocList.appendChild(button);
    });
    document.getElementById("toc-count").textContent = currentBook.chapters.length + " CH";
  }

  function openToc() {
    renderToc();
    navigateTo("toc");
    var selected = tocList.querySelector('[data-chapter="' + chapterIndex + '"]');
    if (selected) selected.focus();
  }

  function chooseChapter(index) {
    chapterIndex = clamp(index, 0, currentBook.chapters.length - 1);
    pageStart = 0;
    resolvePageAt(0);
    navigateTo("reader");
    renderPage(false);
    pageCurrent.focus();
  }

  function openControls() {
    controlsOpen = true;
    readerControls.classList.remove("hidden");
    readerControls.querySelector(".focusable").focus();
    showHud(true);
  }

  function closeControls() {
    controlsOpen = false;
    readerControls.classList.add("hidden");
    if (currentScreen === "reader") pageCurrent.focus();
  }

  function showHud(hold) {
    readerHud.classList.remove("dim");
    if (hudTimer) window.clearTimeout(hudTimer);
    if (!hold) {
      hudTimer = window.setTimeout(function () { readerHud.classList.add("dim"); }, 1500);
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { toast.classList.add("hidden"); }, 1500);
  }

  function tick(weight) {
    try {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var now = audioContext.currentTime;
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(weight > 1 ? 520 : 380, now);
      oscillator.frequency.exponentialRampToValueAtTime(weight > 2 ? 780 : 300, now + 0.07);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(weight > 1 ? 0.055 : 0.025, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.08);
    } catch (error) {}
  }

  function handleAction(action) {
    switch (action) {
      case "pair": startPairing(); break;
      case "refresh-pair": startPairing(); break;
      case "home": saveProgress(); refreshLibrary(); navigateTo("home"); break;
      case "demo":
        if (!books.some(function (book) { return book.id === DEMO_BOOK.id; })) books.unshift(DEMO_BOOK);
        renderLibrary();
        openBook(DEMO_BOOK);
        break;
      case "resume": navigateTo("reader"); pageCurrent.focus(); break;
      case "toc": openToc(); break;
      case "font-down": changeFont(-1); break;
      case "font-up": changeFont(1); break;
    }
  }

  document.addEventListener("click", function (event) {
    var bookButton = event.target.closest("[data-book-id]");
    if (bookButton) {
      var id = bookButton.dataset.bookId;
      loadBook(id).then(openBook).catch(function (error) { showToast(error.message); });
      return;
    }
    var chapterButton = event.target.closest("[data-chapter]");
    if (chapterButton) {
      chooseChapter(Number(chapterButton.dataset.chapter));
      return;
    }
    var action = event.target.closest("[data-action]");
    if (action) handleAction(action.dataset.action);
  });

  pageStage.addEventListener("click", function (event) {
    if (controlsOpen) return;
    if (event.clientX < 300) previousPage();
    else nextPage();
  });

  document.addEventListener("keydown", function (event) {
    if (currentScreen === "reader") {
      if (!controlsOpen) {
        if (event.key === "ArrowLeft") previousPage();
        else if (event.key === "ArrowRight") nextPage();
        else if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter") openControls();
        else if (event.key === "Escape") { saveProgress(); refreshLibrary(); navigateTo("home"); }
        else return;
      } else {
        if (event.key === "Escape") closeControls();
        else if (event.key === "Enter") activateFocused();
        else if (event.key.indexOf("Arrow") === 0) moveFocus(event.key === "ArrowUp" || event.key === "ArrowLeft" ? "up" : "down");
        else return;
      }
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      if (currentScreen === "toc") { navigateTo("reader"); pageCurrent.focus(); }
      else if (currentScreen !== "home") navigateTo("home");
      event.preventDefault();
      return;
    }
    if (event.key === "Enter") activateFocused();
    else if (event.key.indexOf("Arrow") === 0) moveFocus(event.key === "ArrowUp" || event.key === "ArrowLeft" ? "up" : "down");
    else return;
    event.preventDefault();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) saveProgress();
  });
  window.addEventListener("pagehide", saveProgress);

  function init() {
    collectScreens();
    var savedFont = Number(localStorage.getItem(FONT_KEY));
    var savedIndex = FONT_SIZES.indexOf(savedFont);
    if (savedIndex >= 0) fontIndex = savedIndex;
    applyFont();
    deviceToken();
    refreshLibrary();
    navigateTo("home");
  }

  init();
})();
