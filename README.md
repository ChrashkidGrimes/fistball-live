# Fistball Live 🤾

A live results & standings web app (installable **PWA**) for the
**2026 U18 World Championship & Women's EFA Championship** (Reiden, Switzerland · 23–26 July 2026).

Users pick a category and follow **standings** and **match results** that update
automatically from the official Google Sheet — no backend, just static files.

## Features

- **Category selector** — switch between U18 M/W Gold/Silver, WEC, etc.
- **Standings** — computed live from completed group-stage matches
  (points, wins/losses, set ratio, set/point differential, with tiebreakers).
- **Matches** — fixtures & results grouped by day, filterable (All / Live / Finished / Upcoming),
  with per-set scores and live-match highlighting.
- **Live updates** — auto-refresh every 60s and whenever the app regains focus.
- **Installable PWA** — add to home screen on phone/desktop; works offline with the last loaded data.

## How the data works

The app reads the results sheet directly in the browser via the Google
Visualization CSV endpoint:

```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/gviz/tq?tqx=out:csv&gid=<GID>
```

This works **only while the sheet is shared as “Anyone with the link → Viewer”**
(it currently is). No API key or login is required, and viewers never get edit access.

## Scoring & tie-break rules (per-event, read from the `Config` tab)

The app is event-agnostic: it reads the rules from the sheet's **`Config`** tab (by
name), so a different event = a different sheet with its own rules, **no code change**.
The parser scans for labels, so exact cell positions don't matter.

- **Match points** — the existing **Point Table** (`BEST_OF, SETS_VENCEDOR,
  SETS_PERDEDOR, PTS_VENCEDOR, PTS_PERDEDOR`). Each finished match looks up its
  row by (best-of, winner sets, loser sets). This expresses flat win/loss (2/0),
  per-set scoring (`PTS = sets won`), and score bonuses alike.
- **Draws** — a cell labelled **`DRAW_POINTS`** with the value to its right
  (default `1`). A finished match with equal sets is a draw.
- **Tie-breakers** — a cell labelled **`TIEBREAKERS`** with an ordered list read
  **downward** in the same column. Accepted tokens:
  `H2H_SET_DIFF`, `H2H_SET_RATIO`, `H2H_POINT_DIFF`, `H2H_POINT_RATIO`,
  `SET_DIFF`, `SET_RATIO`, `POINT_DIFF`, `POINT_RATIO`, `WINS`
  (`H2H_` = only matches among the tied teams; `QUOTIENT` is accepted for `RATIO`).

**Defaults if `Config` is absent or a setting is missing** — the official IFA rule
(art. 11): win 2 / draw 1 / loss 0, then
`H2H_SET_DIFF → H2H_SET_RATIO → H2H_POINT_DIFF → SET_DIFF → SET_RATIO → POINT_DIFF`,
then drawing of lots (the app keeps a stable order). Head-to-head criteria are
recomputed among whatever subset stays tied (so "between the teams concerned"
is always honoured).

Configuration lives at the top of [`app.js`](app.js):

```js
const CONFIG = {
  sheetId: "1IWuv2zOZtIJDZCFnItp_z8p546azRGlD8I052jVe8Mk",
  gid: "0",          // tab holding the schedule + scores
  refreshMs: 60000,
};
```

> **Note:** the app shows whatever is in that results tab. Right now the tab
> contains matches **16–48** (group stage + first knock-outs). As the organizers
> fill in scores and add the later matches (49–75), they appear automatically —
> no code change needed. New categories also appear on their own.

## Run locally

```bash
python3 -m http.server 8742
# then open http://localhost:8742
```

(A service worker + PWA install only activate over `https://` or `localhost`.)

## Deploy (any static host)

The whole app is static files, so just upload the folder.

**GitHub Pages**
```bash
git init && git add . && git commit -m "Fistball Live"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
# then enable Pages → Deploy from branch → main / root
```

**Netlify / Vercel / Cloudflare Pages** — drag-and-drop the folder, or point it at the repo.
No build step required.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup / app shell |
| `styles.css` | Styling (dark, mobile-first) |
| `app.js` | Data fetch, parsing, standings, rendering |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline shell, live data always from network) |
| `icons/` | App icons (192/512 + maskable) |
