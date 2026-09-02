const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "visit-analytics.js"),
  "utf8",
);

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function runAnalytics(storage, startTime) {
  let now = startTime;
  let randomByte = 0;
  const requests = [];
  const windowListeners = {};
  const documentListeners = {};
  const intervalCallbacks = [];

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  const location = {
    href: "https://gonzalobuilds.com/meta_display/apps/situation/",
    host: "gonzalobuilds.com",
    pathname: "/meta_display/apps/situation/",
    search: "",
  };
  const navigator = {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0",
    platform: "Linux armv8l",
    language: "en-US",
    maxTouchPoints: 1,
  };
  const document = {
    currentScript: {
      getAttribute(name) {
        return {
          "data-posthog-app": "situation",
          "data-posthog-app-version": "2",
        }[name];
      },
    },
    referrer: "",
    visibilityState: "visible",
    createElement() {
      return {};
    },
    addEventListener(name, callback) {
      documentListeners[name] = callback;
    },
    head: {
      appendChild(element) {
        context.POSTHOG_KEY = "test-key";
        context.POSTHOG_HOST = "https://us.i.posthog.com";
        element.onload();
      },
    },
  };

  const context = {
    Date: FakeDate,
    Intl,
    JSON,
    Math,
    URL,
    Uint8Array,
    console,
    document,
    location,
    navigator,
    localStorage: storage,
    screen: { width: 600, height: 600 },
    innerWidth: 600,
    innerHeight: 600,
    crypto: {
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i += 1) {
          randomByte = (randomByte + 17) % 256;
          bytes[i] = randomByte;
        }
        return bytes;
      },
    },
    addEventListener(name, callback) {
      windowListeners[name] = callback;
    },
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    fetch(url, options) {
      requests.push({
        transport: "fetch",
        url,
        payload: JSON.parse(options.body),
      });
      return Promise.resolve({ ok: true });
    },
  };
  context.window = context;

  vm.runInNewContext(source, context, { filename: "visit-analytics.js" });

  return {
    context,
    requests,
    advance(milliseconds) {
      now += milliseconds;
    },
    checkpoint() {
      intervalCallbacks.forEach((callback) => callback());
    },
    hide() {
      document.visibilityState = "hidden";
      documentListeners.visibilitychange();
    },
    pagehide() {
      windowListeners.pagehide();
    },
  };
}

test("captures a launch as a UUIDv7 session with device context", () => {
  const run = runAnalytics(createStorage(), 1_788_388_000_000);
  assert.equal(run.requests.length, 1);

  const pageview = run.requests[0].payload;
  assert.equal(pageview.event, "$pageview");
  assert.equal(pageview.properties.$session_id[14], "7");
  assert.equal(pageview.properties.$device_type, "Mobile");
  assert.equal(pageview.properties.$os, "Android");
  assert.equal(pageview.properties.$browser, "Chrome");
  assert.equal(pageview.properties.app_slug, "situation");
  assert.equal(pageview.properties.installation_id_persisted, true);
  assert.equal(pageview.properties.telemetry_version, 3);
  assert.equal(pageview.properties.session_resumed, false);
  assert.equal(pageview.properties.session_pageview_index, 1);
  run.hide();
  run.pagehide();
  assert.equal(run.requests.length, 1);
});

test("keeps one session across adjacent pageviews", () => {
  const storage = createStorage();
  const first = runAnalytics(storage, 1_788_388_000_000);
  const second = runAnalytics(storage, 1_788_388_010_000);
  const firstPageview = first.requests[0].payload;
  const secondPageview = second.requests[0].payload;

  assert.equal(firstPageview.distinct_id, secondPageview.distinct_id);
  assert.equal(
    firstPageview.properties.$session_id,
    secondPageview.properties.$session_id,
  );
  assert.equal(secondPageview.properties.session_resumed, true);
  assert.equal(secondPageview.properties.session_pageview_index, 2);
});

test("finalizes a checkpointed session on the next launch after inactivity", () => {
  const storage = createStorage();
  const startedAt = 1_788_388_000_000;
  const first = runAnalytics(storage, startedAt);
  first.context.metaDisplayAnalytics.increment("headline_open_count");
  first.context.metaDisplayAnalytics.maximum("max_headline_count", 40);
  first.advance(12_345);
  first.checkpoint();

  const next = runAnalytics(storage, startedAt + 1_812_346);
  assert.equal(next.requests.length, 2);

  const firstPageview = first.requests[0].payload;
  const ended = next.requests[0].payload;
  const nextPageview = next.requests[1].payload;
  assert.equal(ended.event, "meta_display_session_ended");
  assert.equal(ended.properties.$session_id, firstPageview.properties.$session_id);
  assert.equal(ended.properties.session_duration_ms, 12_345);
  assert.equal(ended.properties.session_duration_seconds, 12.3);
  assert.equal(ended.properties.session_pageview_count, 1);
  assert.equal(ended.properties.headline_open_count, 1);
  assert.equal(ended.properties.max_headline_count, 40);
  assert.equal(ended.properties.session_finalized_late, true);
  assert.notEqual(
    nextPageview.properties.$session_id,
    firstPageview.properties.$session_id,
  );
});
