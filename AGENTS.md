# Meta Display Web Apps

Canonical docs and MCP first. See [docs/sources.md](docs/sources.md).

- Developer docs: https://wearables.developer.meta.com/docs/develop/webapps
- Build constraints: https://wearables.developer.meta.com/docs/develop/webapps/build/
- Wearables MCP: https://mcp.developer.meta.com/wearables (`search_webapps_docs`, no auth)
- Toolkit: https://github.com/facebookincubator/meta-wearables-webapp

If MCP is unavailable, use the docs above and state that before proceeding.

## Repo layout

New apps live in `apps/<app-name>/` with `index.html`, `styles.css`, `app.js`, `favicon.png`, and `manifest.webmanifest`.

Vanilla HTML/CSS/JS is the default. Keep the gzipped JS budget under 500KB and initial load under 3s.

## Constraints

- 600x600 viewport, no page scroll
- Dark additive UI: `#000000` page background, dark-gray surfaces, light text
- Arrow keys move focus; Enter activates. Mark controls `.focusable`
- `meta name="mrbd-web-app-capable" content="yes"`
- PNG favicon larger than 52x52. No SVG icons
- On-device testing uses GitHub Pages HTTPS, not Vercel or localhost
- Public launcher: `https://ggoonnzzaallo.github.io/meta_display/`
- Each app URL must keep a trailing slash: `https://ggoonnzzaallo.github.io/meta_display/apps/<name>/`
- After adding `apps/<name>/`, also register it in the root `app.js` `APPS` list
- Situation ingest: `scripts/fetch_feed.py` writes `apps/situation/feed.json` in the Pages job. Do not fetch third-party RSS from the glasses Web App.
- Markets ingest: `scripts/fetch_markets.py` writes `apps/markets/feed.json` (Yahoo quotes for movers, Nasdaq earnings calendar, WSJ/CNBC/SA/BBC headlines). Do not scrape Finviz or fetch third-party feeds from the glasses Web App.
