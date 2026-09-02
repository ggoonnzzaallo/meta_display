/* Lightweight Meta Display visit counting. Loaded only after the app's load event. */
(function () {
  "use strict";

  var loader = document.currentScript;
  var appSlug = loader ? loader.getAttribute("data-posthog-app") : null;

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }

  function capturePageview() {
    var config = document.createElement("script");
    config.src = "/posthog-config.js";
    config.async = true;

    config.onload = function () {
      var key = window.POSTHOG_KEY;
      var host = window.POSTHOG_HOST;
      if (!key || !host || typeof window.fetch !== "function") return;

      var payload = {
        api_key: key,
        event: "$pageview",
        distinct_id: randomId(),
        properties: {
          "$current_url": window.location.href,
          "$pathname": window.location.pathname,
          "$process_person_profile": false,
          surface: "meta_display",
          app_slug: appSlug,
          page_kind: "app"
        }
      };

      window.fetch(host.replace(/\/$/, "") + "/i/v0/e/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
        keepalive: true
      }).catch(function () {
        // Analytics must never affect app behavior.
      });
    };

    config.onerror = function () {
      // Missing or blocked analytics configuration should be invisible to the app.
    };

    document.head.appendChild(config);
  }
  capturePageview();
})();
