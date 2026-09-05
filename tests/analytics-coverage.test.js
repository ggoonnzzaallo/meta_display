const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("every registered app loads telemetry v3 with its slug and version", () => {
  const launcher = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const appPattern = /href: "apps\/([^/]+)\/", version: "v([^"]+)"/g;
  const apps = Array.from(launcher.matchAll(appPattern), (match) => ({
    slug: match[1],
    version: match[2],
  }));

  assert.equal(apps.length, 19);
  apps.forEach(({ slug, version }) => {
    const html = fs.readFileSync(
      path.join(root, "apps", slug, "index.html"),
      "utf8",
    );
    assert.match(html, /\.\.\/\.\.\/visit-analytics\.js\?v=3/);
    assert.match(
      html,
      new RegExp(`data-posthog-app", "${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
    assert.match(
      html,
      new RegExp(`data-posthog-app-version", "${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
  });
});

test("Leaf upload stays in the Leaf analytics session", () => {
  const html = fs.readFileSync(
    path.join(root, "apps", "leaf", "upload", "index.html"),
    "utf8",
  );
  assert.match(html, /\.\.\/\.\.\/\.\.\/visit-analytics\.js\?v=3/);
  assert.match(html, /data-posthog-app", "leaf"/);
});
