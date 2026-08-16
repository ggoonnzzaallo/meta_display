# App backlog

Wearables MCP (`search_webapps_docs`) is declared in [`.cursor/mcp.json`](../.cursor/mcp.json) but is often **not connected** in agent chats — treat the [build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) as the fallback, plus on-device findings in [sources.md](sources.md).

## TODO

- [x] **Cadence** — inward reticle rhythm (`apps/cadence/`)
- [x] **Gyre** — tap left/right to dodge closing hex walls (`apps/gyre/`)
- [x] **Stack** — pinch to drop a sliding bar (`apps/stack/`)
- [x] **Well** — tiny Tetris, pinch to hard-drop (`apps/well/`)
- [x] **Merge** — 6×6 2048, swipe to slide (`apps/merge/`)
- [x] **Putt** — card-golf puzzle, pick a stroke then swipe (`apps/putt/`)
- [x] Register the four games in root `app.js` `APPS`
- [ ] On-device HTTPS test via GitHub Pages (`…/apps/<name>/`)
- [ ] **Names** — pinch to identify people you enrolled (camera + personal gallery)

Play the four games, then keep or cut. Later if we want a slower strategy title: Breach (turn-based tactics).

---

## Shared constraints

These apply to every app in this file.

- Vanilla HTML/CSS/JS in `apps/<name>/` (`index.html`, `styles.css`, `app.js`, PNG favicon ≥52×52, `manifest.webmanifest`)
- Fixed **600×600**, `overflow: hidden`, no page scroll
- Additive UI: page background `#000000`; visible surfaces dark gray; light high-contrast text
- Input: Neural Band / captouch → arrow keys + Enter. Every control is `.focusable` with a visible focus ring
- Camera / mic / location only after a pinch on a `.focusable` control; stop tracks on hide
- Gzipped JS under 500KB, first load under 3s, keep runtime memory in mind (official budget 128MB)
- Host on GitHub Pages, not Vercel. Trailing slash on app URLs
- Official docs still list camera, mic, text input, and offline as unsupported. Camera and mic work on-device (`apps/ioprobe/`, 2026-08-14). Text composer may work via a focused input; verify on-device before depending on it

---

## 1. Names

**Working title:** Names  
**Path:** `apps/names/`  
**One-liner:** Look at someone you already enrolled, pinch, see their name and a one-line reminder.

### Problem

You meet people you should know and the name is gone. The glasses can see them. A HUD that only says **who this is to you** is the useful product — not a stranger-ID scanner.

### Non-goals

- Do not recognize the general public, celebrities, or anyone who is not in **your** gallery
- Do not scrape social networks or send faces to a third-party “who is this” API
- Do not run always-on identification in the background
- Do not draw a live camera feed on the display (the waveguide already shows the person; video would occlude them)
- Do not use head aiming or IMU

### User loop

1. **Enroll (once per person):** pinch to capture a still → type name (and optional note: how you know them) → stored locally
2. **Identify:** look at them → pinch → HUD shows name + note, or “unknown” / top-3 guesses to confirm
3. **Update:** after a match, optional “edit note” so the next meeting is better

### Key features (v1)

- Home: IDENTIFY, ROSTER, HOW
- IDENTIFY starts the camera from the pinch, grabs one or a few frames, then **stops the track**
- HUD result: large name, small note, confidence (high / maybe / unknown). No video panel
- If maybe/unknown: D-pad list of top matches + “not in roster”
- ROSTER: D-pad list of enrolled people; Enter opens detail (name, note, delete, recapture)
- Persist gallery in `localStorage` / IndexedDB (embeddings + notes). Stay well under the 5MB web-storage cap
- Desktop: file/webcam enroll so we can smoke-test without glasses

### Key features (v1.1, only if v1 works on-device)

- Multiple photos per person (better angles / lighting)
- Last-seen timestamp
- “Add note” after a successful match without leaving identify

### Technical approach

- Capture: `getUserMedia({ video: true })` after pinch, `canvas.drawImage` → still, then `track.stop()`
- Match: local face embedding vs your gallery (tiny model loaded lazily from a CDN, not shipped in the first 500KB). If on-device ML is too heavy or too slow, fall back to “capture + you pick from roster” rather than a cloud face API
- Enrollment name/note: try a standard text field (on-glasses composer). If composer is dead on-device, ship a D-pad letter grid so the app still works
- Privacy copy on HOW: only people you enroll; frames are not uploaded

### Risks

- We have proven a **live preview**, not yet canvas stills + ML on-device
- Model size / 128MB memory / “instant” (target: result in ~2s, not 200ms)
- Lighting, sunglasses, profile views — keep the top-3 confirm path
- Composer / text input may still be blocked on glasses

### Success

- Enroll 5 people on desktop, match the right one most of the time
- On glasses: pinch → name HUD, no video overlay, camera LED/track stops after the shot
- Unknown person does not get a confident wrong name

---

## 2. Cadence

**Working title:** Cadence  
**Path:** `apps/cadence/`  
**One-liner:** A 4-lane rhythm game you play with the Neural Band — timing and dexterity, head stays still.

### Problem

Lock On and Strike both ask you to aim with your head. Head tracking on these glasses is noisy, and moving your head to play is tiring. The band is a reliable Game Boy pad: four directions + pinch. Use that.

### Design rules

- **No IMU / head aiming.** Head-still is a feature
- Skill comes from **when** you pinch and **which** direction you hit, not from looking around
- Head-still 80s HUD: dark field, bright lanes, cyan focus language
- Optional: continuous pinch-drag is **off** for v1 (discrete D-pad + Enter only)

### User loop

1. Title: PLAY, HOW
2. Four vertical lanes. Notes fall toward a hit line at the bottom
3. Left / right (or up / down) moves the active lane, **or** each arrow hits its own lane (prefer **one arrow = one lane**, like DDR — less menu-focus, more instrument)
4. Pinch / Enter is not required if arrows are the hits; keep pinch as an optional center-lane or “smash” if we want five inputs
5. Hit window: perfect / ok / miss. Miss streak ends the run (or a short health bar)
6. Speed and density rise by song/section. Best score in `localStorage`

### Key features (v1)

- Title, how-to, play, pause (Escape), game over
- One built-in chart (no audio file required): a seeded pattern that ramps for ~90 seconds
- Four lanes mapped to ArrowLeft / ArrowDown / ArrowUp / ArrowRight
- Hit line + falling notes on canvas at 60fps
- Scoring: combo, perfects, best
- Mute toggle if we add a click/tick; silence is better than a bad loop (Lock On lesson)
- Desktop: same keys. No demo-IMU mode

### Key features (later)

- A second chart with a different rhythm
- Optional Web Audio metronome clicks (only if they feel tight on-device)
- Breach (below) as the strategy counterpart

### Non-goals

- Head-tilt steering, camera, or “look at the world to play”
- Licensed music, large audio assets, or a chart editor in v1
- Analog stick / continuous drag

### Risks

- Arrow repeat / key-down vs key-up on the band — verify we get clean taps, not held-key flood
- 600×600 readability: notes and hit line must be huge
- If the band coalesces diagonals, charts must avoid requiring two lanes in the same instant

### Success

- Playable without moving your head
- A clean 90-second run feels like skill, not like fighting the input
- Best score persists across reloads

---

## 3. Later: Breach (strategy counterpart)

**Working title:** Breach  
**Path:** `apps/breach/`  
**One-liner:** Tiny turn-based tactics. Think, then commit with the band.

Not the first game. Build if Cadence is fun and we want a slower, brainier loop.

- 4×4 or 5×5 grid, 60-second missions
- D-pad moves a cursor; pinch selects / confirms a move
- 2–3 player units vs a few enemies; terrain blocks
- Undo before confirm; no real-time twitch
- Same HUD rules as Cadence (no head, no camera)

---

## Open questions

- Names: confirm on-device that a `<canvas>` grab from `getUserMedia` is allowed, not just a `<video>` preview
- Names: composer vs D-pad keyboard for enrollment
- Cadence: confirm the band sends discrete arrow taps (not sticky hold) so a rhythm chart is fair
