(function () {
  "use strict";

  var API_URL = "https://yvbirjzcrlnnzwdrntxp.supabase.co/functions/v1/leaf";
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var MAX_TEXT_BYTES = 8 * 1024 * 1024;
  var fileInput = document.getElementById("epub-file");
  var codeInput = document.getElementById("pair-code");
  var form = document.getElementById("upload-form");
  var sendButton = document.getElementById("send-button");
  var statusEl = document.getElementById("status");
  var fileSummary = document.getElementById("file-summary");
  var preview = document.getElementById("book-preview");
  var parsedBook = null;

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function normalizeCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
  }

  codeInput.addEventListener("input", function () {
    var code = normalizeCode(codeInput.value);
    codeInput.value = code.length > 4 ? code.slice(0, 4) + " " + code.slice(4) : code;
  });

  function decode(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function elementsByName(root, name) {
    return Array.from(root.getElementsByTagName("*")).filter(function (node) {
      return node.localName && node.localName.toLowerCase() === name.toLowerCase();
    });
  }

  function firstText(root, name) {
    var node = elementsByName(root, name)[0];
    return node ? String(node.textContent || "").trim() : "";
  }

  function resolvePath(base, href) {
    var url = new URL(href, "https://leaf.invalid/" + base);
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  }

  function parseXml(text, label) {
    var documentNode = new DOMParser().parseFromString(text, "application/xml");
    if (documentNode.querySelector("parsererror")) throw new Error("Could not read " + label + ".");
    return documentNode;
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u00ad/g, "")
      .replace(/[\t\r ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractChapter(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script, style, noscript, iframe, object, embed, svg, canvas, form, nav").forEach(function (node) {
      node.remove();
    });
    var selector = "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre";
    var blocks = Array.from(doc.body.querySelectorAll(selector)).filter(function (node) {
      return !node.parentElement || !node.parentElement.closest(selector);
    }).map(function (node) {
      var text = cleanText(node.textContent);
      if (/^h[1-6]$/i.test(node.tagName) && text) return text.toUpperCase();
      if (node.tagName === "LI" && text) return "• " + text;
      return text;
    }).filter(Boolean);
    if (!blocks.length) return cleanText(doc.body.textContent);
    return cleanText(blocks.join("\n\n"));
  }

  function navTitles(files, manifest, opfPath) {
    var titles = {};
    var navItem = Object.keys(manifest).map(function (key) { return manifest[key]; }).find(function (item) {
      return String(item.properties || "").split(/\s+/).indexOf("nav") >= 0;
    });
    if (!navItem) return titles;
    var navPath = resolvePath(opfPath, navItem.href);
    if (!files[navPath]) return titles;
    var doc = new DOMParser().parseFromString(decode(files[navPath]), "text/html");
    doc.querySelectorAll("a[href]").forEach(function (anchor) {
      var href = anchor.getAttribute("href").split("#")[0];
      var path = resolvePath(navPath, href || navPath.split("/").pop());
      var title = cleanText(anchor.textContent);
      if (title && !titles[path]) titles[path] = title;
    });
    return titles;
  }

  function parseEpub(buffer, filename) {
    if (!window.fflate || !window.fflate.unzipSync) throw new Error("The EPUB reader library did not load.");
    var files;
    try {
      files = window.fflate.unzipSync(new Uint8Array(buffer));
    } catch (error) {
      throw new Error("This file is not a readable EPUB archive.");
    }
    var containerBytes = files["META-INF/container.xml"];
    if (!containerBytes) throw new Error("The EPUB is missing META-INF/container.xml.");
    var container = parseXml(decode(containerBytes), "the EPUB container");
    var rootfile = elementsByName(container, "rootfile")[0];
    var opfPath = rootfile && rootfile.getAttribute("full-path");
    if (!opfPath || !files[opfPath]) throw new Error("The EPUB package document is missing.");

    var opf = parseXml(decode(files[opfPath]), "the EPUB package");
    var manifest = {};
    elementsByName(opf, "item").forEach(function (item) {
      var id = item.getAttribute("id");
      if (!id) return;
      manifest[id] = {
        href: item.getAttribute("href") || "",
        mediaType: item.getAttribute("media-type") || "",
        properties: item.getAttribute("properties") || "",
      };
    });
    var titles = navTitles(files, manifest, opfPath);
    var chapters = [];
    elementsByName(opf, "itemref").forEach(function (itemref, index) {
      var item = manifest[itemref.getAttribute("idref")];
      if (!item || !/html|xhtml/i.test(item.mediaType)) return;
      var path = resolvePath(opfPath, item.href);
      if (!files[path]) return;
      var text = extractChapter(decode(files[path]));
      if (!text || text.length < 2) return;
      var fallbackDoc = new DOMParser().parseFromString(decode(files[path]), "text/html");
      var heading = fallbackDoc.querySelector("h1, h2, h3, title");
      var title = titles[path] || cleanText(heading && heading.textContent) || "Chapter " + (index + 1);
      chapters.push({ id: itemref.getAttribute("id") || "chapter-" + (index + 1), title: title, text: text });
    });
    if (!chapters.length) throw new Error("Leaf could not find readable chapters in this EPUB.");

    var book = {
      title: firstText(opf, "title") || filename.replace(/\.epub$/i, "") || "Untitled",
      author: firstText(opf, "creator") || "Unknown author",
      chapters: chapters,
    };
    var size = new TextEncoder().encode(JSON.stringify(book)).length;
    if (size > MAX_TEXT_BYTES) throw new Error("This EPUB contains too much text for Leaf v1 (8 MB maximum after conversion).");
    return book;
  }

  function showPreview(book) {
    document.getElementById("preview-title").textContent = book.title;
    document.getElementById("preview-author").textContent = book.author;
    var words = book.chapters.reduce(function (count, chapter) {
      return count + chapter.text.split(/\s+/).filter(Boolean).length;
    }, 0);
    document.getElementById("preview-detail").textContent = book.chapters.length + " chapters · about " + words.toLocaleString() + " words";
    preview.classList.remove("hidden");
  }

  fileInput.addEventListener("change", function () {
    parsedBook = null;
    preview.classList.add("hidden");
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    fileSummary.textContent = file.name + " · " + (file.size / 1024 / 1024).toFixed(1) + " MB";
    if (!/\.epub$/i.test(file.name) || file.size > MAX_FILE_BYTES) {
      setStatus(file.size > MAX_FILE_BYTES ? "Choose an EPUB smaller than 20 MB." : "Choose a file ending in .epub.", "error");
      return;
    }
    setStatus("Reading the EPUB on this device…");
    file.arrayBuffer().then(function (buffer) {
      parsedBook = parseEpub(buffer, file.name);
      showPreview(parsedBook);
      setStatus("Ready to send. The original EPUB remains on this device.");
    }).catch(function (error) {
      setStatus(error.message, "error");
    });
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var code = normalizeCode(codeInput.value);
    if (code.length !== 8) {
      setStatus("Enter the eight-character code shown on the glasses.", "error");
      codeInput.focus();
      return;
    }
    if (!parsedBook) {
      setStatus("Choose and preview an EPUB first.", "error");
      fileInput.focus();
      return;
    }
    sendButton.disabled = true;
    sendButton.textContent = "SENDING…";
    setStatus("Sending the sanitized book to your private Leaf library…");
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upload", code: code, book: parsedBook }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body.error || "The book could not be sent.");
        return body;
      });
    }).then(function () {
      setStatus("Sent. Your glasses will open the book in a moment.", "success");
      sendButton.textContent = "SENT TO LEAF";
    }).catch(function (error) {
      setStatus(error.message, "error");
      sendButton.disabled = false;
      sendButton.textContent = "SEND TO GLASSES";
    });
  });
})();
