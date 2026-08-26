# What the glasses can actually do

The [official build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) is still the product page of record, but it lags. Treat this file as the working capability list for this repo.

Sources, in order:

1. Official build / setup / test pages
2. [AI toolkit v127](https://github.com/facebookincubator/meta-wearables-webapp/commit/24d7bfc553d33d7fe849cd70d04544b1de555896) (2026-08-06) — `add-gestures`, `add-text-input`, `add-offline`
3. On-device checks in this repo (`apps/ioprobe/` 2026-08-14; Gyre menu bug with `touch-action: none`)

If those disagree, follow official docs for safety-critical claims, then verify on-device before depending on a toolkit-only API.

---

## Input (Neural Band + captouch)

Default model is unchanged: **D-pad moves focus, pinch activates the focused control.** Pinch is Enter/click on `document.activeElement`. It is not a positioned click. Every control still needs `.focusable`.

### Pinch-and-drag (opt-in)

Toolkit v127: continuous pinch-and-drag is **off by default**. There is still no free cursor. To receive a pointer stream (sliders, maps, drawing, analog games):

```css
body { touch-action: none; }
```

Rules that bit us:

- Put it in the **initial stylesheet**, on **`<body>` only**. Per-element `touch-action` and post-load JS changes are ignored.
- It is **page-wide**. You cannot enable drag on the play canvas and leave menus on D-pad-only.
- Listen to `pointerdown` / `pointermove` / `pointerup`. Prefer `clientX` / `clientY` deltas you compute yourself. Log `pointermove` on-device before trusting `movementX` / `movementY`.
- **Do not** call `requestPointerLock`.
- **Gyre (on-device):** `body { touch-action: none }` plus a page-level pointer handler ate pinches on PLAY / HOW. Do not opt in unless the app actually needs analog drag, and keep menu screens working (separate page, or ignore pointer events while a menu is up).

Leave drag **off** for D-pad games (Trio, Court, Gyre, Cadence, …). Opt in only when analog motion is the product.

### Back gesture

Toolkit: thumb + middle-finger (or **Escape**) is back. Templates dropped the on-screen Back button. This repo can keep an in-app Back control for clarity; still handle Escape. Official docs still list “Back Navigation” as unsupported — meaning there is no browser history chrome, not that Escape is dead.

### Text composer

Toolkit: a focused `<input type="text|search|email|url|tel|number">`, `<textarea>`, or `contenteditable` opens the on-glasses **handwriting + voice composer** on **focus then pinch**. Not on focus alone. Programmatic `.focus()` will not open it.

- Read the value from `input` / `change`, not `keydown`.
- `type=password`, date, checkbox, radio do not open the composer.
- `inputmode` / `enterkeyhint` do not change the composer UI.
- Keep a D-pad fallback (Names: letter grid) until we confirm composer on-device.

---

## Camera, mic, location

Official guide still lists camera and microphone as unsupported. `apps/ioprobe/` on glasses got all three after a pinch:

- Camera: `getUserMedia({ video: true })`
- Microphone: `getUserMedia({ audio: true })`
- Location: `geolocation` from the paired phone (also in the official guide)

Request only from a user gesture. Stop tracks on hide. IMU (`DeviceMotion` / `DeviceOrientation`) is documented; also requires a user gesture (`add-device-sensors`).

---

## Offline

Toolkit v127: Service Worker + Cache API for an app shell. Official guide still lists Offline as unsupported.

If we add it:

- HTTPS only (GitHub Pages is fine).
- Register a **relative** `sw.js` next to the app (`apps/<name>/sw.js`), not `/sw.js` — Pages lives under `/meta_display/`.
- Precache the real URLs this app loads (`index.html`, `app.js?v=N`, `styles.css?v=N`, `favicon.png`).
- Bump the cache name when those files change, or wearers keep a stale build.
- Situation / Markets still need network for fresh `feed.json`; show last cache or an offline message.

Do not add a service worker by default. Cache-bust query strings (`?v=N`) already fight stale Pages; a SW that caches the old `?v=` will make that worse.

---

## Still not supported (as of official build guide)

- Notifications
- A free-roaming continuous cursor (drag is an opt-in pointer stream, not a mouse)
- SVG favicons
- Vercel as the on-device host in this repo (glasses need HTTPS; we use GitHub Pages)

---

## What is useful for *this* repo

| Capability | Use it? | Where |
| ---------- | ------- | ----- |
| Pinch-and-drag | Yes, only if analog control is the mechanic | New games: drawing, analog steering, sliders. Not existing D-pad titles |
| Text composer | Yes, with a fallback | Names enrollment; any search box |
| Service Worker | Maybe later | Games that should survive flaky Wi-Fi. Not Situation/Markets as the only path |
| Back gesture / Escape | Already | Pause / leave play. Optional on-screen Back is fine |
| Camera / mic | Yes after pinch | Names, IO Probe |
| IMU / head aim | Avoid for games | Lock On / Strike were tiring; keep Neural Band as the skill channel |
