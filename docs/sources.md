# Canonical sources

Always treat these as the source of truth for Meta Ray-Ban Display Web Apps. Re-check them before scaffolding, layout, input, sensors, or deploy work.

## Official docs

- [Web Apps overview](https://wearables.developer.meta.com/docs/develop/webapps)
- [Setup](https://wearables.developer.meta.com/docs/develop/webapps/setup/) — hardware, Meta AI app v272+, glasses v125+, Developer Mode, HTTPS hosting (this repo uses GitHub Pages, not Vercel)
- [Build](https://wearables.developer.meta.com/docs/develop/webapps/build/) — 600x600 viewport, additive display, D-pad input, sensors, location, storage, icons
- [Test](https://wearables.developer.meta.com/docs/develop/webapps/test/) — add a Web App in the Meta AI app, desktop checks, Display Simulator
- [Announcement](https://developers.meta.com/blog/build-for-display-glasses/)

## AI toolkit

- [facebookincubator/meta-wearables-webapp](https://github.com/facebookincubator/meta-wearables-webapp)
- Wearables MCP: `https://mcp.developer.meta.com/wearables` — tool `search_webapps_docs` (no auth). Declared in [`.cursor/mcp.json`](../.cursor/mcp.json). If that server is missing from the agent tool list, use the docs above and say so.

## Backlog

- [App backlog / PRDs](backlog.md) — Names (face-to-name) and Cadence (Neural Band rhythm)

## On-device I/O findings

The [build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) still lists camera and microphone as unsupported. `apps/ioprobe/` on glasses (2026-08-14) got live streams from `getUserMedia` for both, plus `navigator.geolocation`. Request only from a user gesture.

## Chrome simulator

- [Meta Ray-Ban Display Web App Simulator](https://chromewebstore.google.com/detail/jpjlmmodokemlepklkdbimceggpbjcll)
