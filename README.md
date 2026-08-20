# meta_display

Web Apps for Meta Ray-Ban Display glasses.

Apps in this repo are standard HTML/CSS/JavaScript, sized for the 600×600 additive display and driven by Neural Band / captouch input (arrow keys + Enter).

## Canonical docs

Re-read these before building or changing a Web App:

- [Web Apps overview](https://wearables.developer.meta.com/docs/develop/webapps)
- [Setup](https://wearables.developer.meta.com/docs/develop/webapps/setup/)
- [Build](https://wearables.developer.meta.com/docs/develop/webapps/build/)
- [Test](https://wearables.developer.meta.com/docs/develop/webapps/test/)
- [Build for display glasses](https://developers.meta.com/blog/build-for-display-glasses/)
- [AI toolkit](https://github.com/facebookincubator/meta-wearables-webapp)

Full link list: [docs/sources.md](docs/sources.md).

## Local Setup

No package manager is required.

1. Serve the repo root (launcher + apps), matching GitHub Pages:

   ```bash
   npx --yes serve . -l 5173
   ```

2. Open [http://localhost:5173](http://localhost:5173) in Chrome. Situation is at `/apps/situation/`. Markets is at `/apps/markets/`. IO Probe is at `/apps/ioprobe/`.
3. Use **arrow keys** to move focus and **Enter** to activate. That is the same input model the glasses send. Still is at `/apps/still/`.
4. Optional: install the [Display Simulator Chrome extension](https://chromewebstore.google.com/detail/jpjlmmodokemlepklkdbimceggpbjcll) and toggle it on the page to preview additive blending.

## Public hosting (GitHub Pages)

Apps are served over HTTPS from this repo, which is what the glasses require. Meta’s toolkit defaults to Vercel; this project uses GitHub Pages instead.

- Launcher: [https://gonzalobuilds.com/meta_display/](https://gonzalobuilds.com/meta_display/)
- Situation: [https://gonzalobuilds.com/meta_display/apps/situation/](https://gonzalobuilds.com/meta_display/apps/situation/)
- Markets: [https://gonzalobuilds.com/meta_display/apps/markets/](https://gonzalobuilds.com/meta_display/apps/markets/)
- Starter: [https://gonzalobuilds.com/meta_display/apps/starter/](https://gonzalobuilds.com/meta_display/apps/starter/)
- IO Probe: [https://gonzalobuilds.com/meta_display/apps/ioprobe/](https://gonzalobuilds.com/meta_display/apps/ioprobe/)
- Still: [https://gonzalobuilds.com/meta_display/apps/still/](https://gonzalobuilds.com/meta_display/apps/still/)

Pushes to `main` and a **15-minute** schedule deploy via `.github/workflows/pages.yml`. Situation ingest is MTS-only (`scripts/fetch_feed.py`); glasses do not fetch third-party RSS. Markets and Situation read same-origin `feed.json` files built in that job. Keep a trailing slash on app URLs so relative CSS/JS resolve.

If a deploy fails with “Pages site not found,” enable it once: **Settings → Pages → Source → GitHub Actions**, then re-run the workflow.

## Glasses checklist

From the [setup guide](https://wearables.developer.meta.com/docs/develop/webapps/setup/):

1. Meta Ray-Ban Display glasses on software **v125+** (Meta AI app → Devices → gear → General → About → Release Version).
2. Meta AI app **v272+** (Settings → App Info).
3. Enable Developer Mode: Settings → App Info, tap the **App version** number five times.
4. In the Meta AI app: App Settings → App Connections → Web Apps → Add a Web App → name + the HTTPS Pages URL → Connect.

## Layout

```text
index.html        600×600 launcher (lists apps)
apps/trace/       pinch-and-drag outline tracing
apps/situation/   unofficial headline terminal (data from monitor-the-situation.com via feed.json)
apps/markets/     movers, earnings, headlines (Yahoo quotes + Nasdaq + WSJ/CNBC/SA)
apps/starter/     smoke-test Web App
apps/ioprobe/     camera / mic / location permission probe
apps/still/       IMU-stabilized reading (walk-bounce cancel)
scripts/fetch_feed.py     builds apps/situation/feed.json from MTS only
scripts/fetch_markets.py  builds apps/markets/feed.json for Pages
docs/sources.md   canonical documentation links
.cursor/          Wearables MCP + project rules
```

Each new app should live in `apps/<name>/` and be added to the `APPS` list in root `app.js`.
