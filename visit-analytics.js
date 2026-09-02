/* Lightweight Meta Display analytics. Loaded only after the app's load event. */
(function () {
  "use strict";

  var TELEMETRY_VERSION = 3;
  var INSTALLATION_KEY = "meta_display_analytics_installation_v1";
  var SESSION_KEY_PREFIX = "meta_display_analytics_session_v1:";
  var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  var CHECKPOINT_INTERVAL_MS = 30 * 1000;
  var loader = document.currentScript;
  var appSlug = loader ? loader.getAttribute("data-posthog-app") : null;
  var appVersion = loader
    ? loader.getAttribute("data-posthog-app-version")
    : null;
  var windowId = uuidV7();
  var installation = installationId();
  var previousSession = null;
  var session = prepareSession();
  var sessionId = session.id;
  var sessionMetrics = session.metrics;
  var endpoint = null;
  var projectKey = null;

  function randomBytes(length) {
    var bytes = new Uint8Array(length);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      try {
        window.crypto.getRandomValues(bytes);
        return bytes;
      } catch (err) {
        /* Fall through to a non-cryptographic ID. */
      }
    }
    for (var i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }

  // PostHog's session model expects UUIDv7 so the session start time is encoded.
  function uuidV7() {
    var bytes = randomBytes(16);
    var timestamp = Date.now();
    bytes[0] = Math.floor(timestamp / 1099511627776);
    bytes[1] = Math.floor(timestamp / 4294967296);
    bytes[2] = Math.floor(timestamp / 16777216);
    bytes[3] = Math.floor(timestamp / 65536);
    bytes[4] = Math.floor(timestamp / 256);
    bytes[5] = timestamp;
    bytes[6] = (bytes[6] & 15) | 112;
    bytes[8] = (bytes[8] & 63) | 128;

    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      hex += (bytes[i] + 256).toString(16).slice(-2);
    }
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }

  function installationId() {
    var id = null;
    var persisted = false;
    try {
      id = window.localStorage.getItem(INSTALLATION_KEY);
      if (!id) {
        id = uuidV7();
        window.localStorage.setItem(INSTALLATION_KEY, id);
      }
      persisted = window.localStorage.getItem(INSTALLATION_KEY) === id;
    } catch (err) {
      id = uuidV7();
    }
    return { id: id, persisted: persisted };
  }

  function sessionKey() {
    return SESSION_KEY_PREFIX + (appSlug || "unknown");
  }

  function readSession() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(sessionKey()));
      if (
        parsed &&
        typeof parsed.id === "string" &&
        typeof parsed.startedAt === "number" &&
        typeof parsed.lastSeenAt === "number"
      ) {
        parsed.metrics = parsed.metrics || {};
        parsed.pageviewCount = Number(parsed.pageviewCount) || 0;
        return parsed;
      }
    } catch (err) {
      /* Missing or unavailable storage starts a new session. */
    }
    return null;
  }

  function writeSession(value) {
    try {
      window.localStorage.setItem(sessionKey(), JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function prepareSession() {
    var now = Date.now();
    var saved = readSession();
    var idleMs = saved ? Math.max(0, now - saved.lastSeenAt) : Infinity;
    var current = saved;

    if (!saved || idleMs > SESSION_TIMEOUT_MS) {
      previousSession = saved;
      current = {
        id: uuidV7(),
        startedAt: now,
        lastSeenAt: now,
        pageviewCount: 0,
        metrics: {},
        appSlug: appSlug,
        appVersion: appVersion,
        analyticsTest: isAnalyticsTest(),
        telemetryVersion: TELEMETRY_VERSION,
      };
    }

    current.lastSeenAt = now;
    current.pageviewCount += 1;
    current.appVersion = appVersion;
    current.analyticsTest = isAnalyticsTest();
    current.telemetryVersion = TELEMETRY_VERSION;
    writeSession(current);
    return current;
  }

  function trimmed(value, maxLength) {
    if (typeof value !== "string" || !value) return null;
    return value.length > maxLength
      ? value.slice(0, Math.max(0, maxLength - 3)) + "..."
      : value;
  }

  function detectOs(userAgent, platform) {
    var value = (userAgent + " " + platform).toLowerCase();
    if (value.indexOf("android") !== -1) return "Android";
    if (/iphone|ipad|ipod/.test(value)) return "iOS";
    if (value.indexOf("windows") !== -1) return "Windows";
    if (/macintosh|mac os/.test(value)) return "Mac OS X";
    if (value.indexOf("cros") !== -1) return "Chrome OS";
    if (value.indexOf("linux") !== -1) return "Linux";
    return null;
  }

  function detectBrowser(userAgent) {
    if (/edg\//i.test(userAgent)) return "Microsoft Edge";
    if (/opr\//i.test(userAgent)) return "Opera";
    if (/firefox\//i.test(userAgent)) return "Firefox";
    if (/chrome\//i.test(userAgent)) return "Chrome";
    if (/safari\//i.test(userAgent)) return "Safari";
    return null;
  }

  function detectDeviceType(userAgent, mobileHint) {
    if (/ray-ban|wearable|meta quest/i.test(userAgent)) return "Wearable";
    if (/ipad|tablet/i.test(userAgent)) return "Tablet";
    if (mobileHint || /android|iphone|ipod|mobile/i.test(userAgent)) {
      return "Mobile";
    }
    return userAgent ? "Desktop" : null;
  }

  function referringDomain() {
    if (!document.referrer) return "$direct";
    try {
      return new URL(document.referrer).host || "$direct";
    } catch (err) {
      return "$direct";
    }
  }

  function timezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (err) {
      return null;
    }
  }

  function isAnalyticsTest() {
    try {
      return new URL(window.location.href).searchParams.has("analytics_test");
    } catch (err) {
      return window.location.search.indexOf("analytics_test") !== -1;
    }
  }

  function environmentProperties() {
    var nav = window.navigator || {};
    var userAgentData = nav.userAgentData || {};
    var userAgent = trimmed(nav.userAgent, 1000);
    var platform = trimmed(userAgentData.platform || nav.platform, 160);
    var mobileHint =
      typeof userAgentData.mobile === "boolean" ? userAgentData.mobile : null;
    var props = {
      "$current_url": window.location.href,
      "$host": window.location.host,
      "$pathname": window.location.pathname,
      "$referrer": document.referrer || "$direct",
      "$referring_domain": referringDomain(),
      "$screen_height": window.screen ? window.screen.height : null,
      "$screen_width": window.screen ? window.screen.width : null,
      "$viewport_height": window.innerHeight,
      "$viewport_width": window.innerWidth,
      "$timezone": timezone(),
      "$timezone_offset": new Date().getTimezoneOffset(),
      "$browser_language": trimmed(nav.language, 80),
      "$lib": "meta-display-lite",
      "$lib_version": String(TELEMETRY_VERSION),
      "$process_person_profile": false,
      "$session_id": sessionId,
      "$window_id": windowId,
      surface: "meta_display",
      app_slug: appSlug,
      app_version: appVersion,
      page_kind: "app",
      telemetry_version: TELEMETRY_VERSION,
      installation_id_persisted: installation.persisted,
      app_target_device: "Meta Ray-Ban Display",
      client_platform: platform,
      client_mobile_hint: mobileHint,
      client_max_touch_points:
        typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : null,
      client_user_agent_available: !!userAgent,
      analytics_test: isAnalyticsTest(),
    };

    var os = detectOs(userAgent || "", platform || "");
    var browser = detectBrowser(userAgent || "");
    var deviceType = detectDeviceType(userAgent || "", mobileHint);
    if (userAgent) props.$raw_user_agent = userAgent;
    if (os) props.$os = os;
    if (browser) props.$browser = browser;
    if (deviceType) props.$device_type = deviceType;
    return props;
  }

  var baseProperties = environmentProperties();

  function eventProperties(properties) {
    var out = {};
    var key;
    for (key in baseProperties) {
      if (baseProperties[key] !== null && baseProperties[key] !== undefined) {
        out[key] = baseProperties[key];
      }
    }
    for (key in properties) {
      if (properties[key] !== null && properties[key] !== undefined) {
        out[key] = properties[key];
      }
    }
    out.$insert_id = uuidV7();
    return out;
  }

  function send(eventName, properties) {
    if (!endpoint || !projectKey) return false;
    var body = JSON.stringify({
      api_key: projectKey,
      event: eventName,
      distinct_id: installation.id,
      properties: eventProperties(properties || {}),
    });

    if (typeof window.fetch !== "function") return false;
    window
      .fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        credentials: "omit",
        keepalive: true,
      })
      .catch(function () {
        // Analytics must never affect app behavior.
      });
    return true;
  }

  function validMetricName(name) {
    return typeof name === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(name);
  }

  function checkpoint() {
    session.lastSeenAt = Date.now();
    session.metrics = sessionMetrics;
    writeSession(session);
  }

  window.metaDisplayAnalytics = {
    increment: function (name, amount) {
      if (!validMetricName(name)) return;
      var increment = typeof amount === "number" ? amount : 1;
      sessionMetrics[name] = (Number(sessionMetrics[name]) || 0) + increment;
      checkpoint();
    },
    maximum: function (name, value) {
      if (!validMetricName(name) || typeof value !== "number") return;
      sessionMetrics[name] = Math.max(Number(sessionMetrics[name]) || 0, value);
      checkpoint();
    },
  };

  function sendPreviousSession() {
    if (!previousSession) return;
    var durationMs = Math.max(
      0,
      previousSession.lastSeenAt - previousSession.startedAt,
    );
    var summary = {
      "$session_id": previousSession.id,
      app_slug: previousSession.appSlug,
      app_version: previousSession.appVersion,
      analytics_test: previousSession.analyticsTest,
      telemetry_version: previousSession.telemetryVersion,
      session_end_reason: "next_launch_after_inactivity",
      session_duration_ms: durationMs,
      session_duration_seconds: Math.round(durationMs / 100) / 10,
      session_pageview_count: previousSession.pageviewCount,
      session_finalized_late: true,
      session_started_at: new Date(previousSession.startedAt).toISOString(),
      session_last_seen_at: new Date(previousSession.lastSeenAt).toISOString(),
    };
    var metrics = previousSession.metrics || {};
    for (var key in metrics) summary[key] = metrics[key];
    send("meta_display_session_ended", summary);
  }

  function bindCheckpoints() {
    window.addEventListener("pagehide", function () {
      checkpoint();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        checkpoint();
      }
    });
    if (typeof window.setInterval === "function") {
      window.setInterval(function () {
        if (document.visibilityState !== "hidden") checkpoint();
      }, CHECKPOINT_INTERVAL_MS);
    }
  }

  function start() {
    var config = document.createElement("script");
    config.src = "/posthog-config.js";
    config.async = true;

    config.onload = function () {
      projectKey = window.POSTHOG_KEY;
      var host = window.POSTHOG_HOST;
      if (!projectKey || !host) return;
      endpoint = host.replace(/\/$/, "") + "/i/v0/e/";
      sendPreviousSession();
      send("$pageview", {
        session_started_at: new Date(session.startedAt).toISOString(),
        session_resumed: session.pageviewCount > 1,
        session_pageview_index: session.pageviewCount,
      });
    };

    config.onerror = function () {
      // Missing or blocked analytics configuration should be invisible to the app.
    };

    document.head.appendChild(config);
  }

  bindCheckpoints();
  start();
})();
