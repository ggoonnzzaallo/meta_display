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
- Toolkit **v127** (2026-08-06): [commit 24d7bfc](https://github.com/facebookincubator/meta-wearables-webapp/commit/24d7bfc553d33d7fe849cd70d04544b1de555896) — pinch-and-drag, on-glasses text composer, Service Worker offline, back gesture instead of an on-screen Back button
- Wearables MCP: `https://mcp.developer.meta.com/wearables` — tool `search_webapps_docs` (no auth). Declared in [`.cursor/mcp.json`](../.cursor/mcp.json). If that server is missing from the agent tool list, use the docs above and say so.

## Working capability list

- [What the glasses can actually do](capabilities.md) — official vs toolkit v127 vs on-device. Read this before treating “unsupported” as a hard no.

## Backlog

- [App backlog / PRDs](backlog.md) — Names (face-to-name) and Cadence (Neural Band rhythm)

## On-device I/O findings

The [build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) still lists camera, microphone, text input, offline, back navigation, and continuous cursor as unsupported. In practice:

- Camera, mic, location: `apps/ioprobe/` (2026-08-14) after a user gesture
- Pinch-and-drag / composer / offline: documented in toolkit v127; verify on-device before shipping a dependency. See [capabilities.md](capabilities.md)
- Gyre: `body { touch-action: none }` on the whole page ate menu pinches — do not opt into drag unless the app needs analog motion

## Chrome simulator

- [Meta Ray-Ban Display Web App Simulator](https://chromewebstore.google.com/detail/jpjlmmodokemlepklkdbimceggpbjcll)
