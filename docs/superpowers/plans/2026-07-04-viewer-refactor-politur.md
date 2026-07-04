# Teilprojekt 7: Viewer-Refactor + Politur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the viewer's 795-line `app.js` into focused ES modules with
unit-tested standings logic, then polish UX (skeletons, a11y, mobile nav,
transitions) and harden security (vendored supabase-js, CSP, escaping,
robust cache parsing) — without changing behavior.

**Architecture:** Pure logic moves to `js/standings.js` (parameterized, no
DOM/state access) and gets unit tests. Rendering splits into
`js/views/*.js`; shared constants/helpers into `js/meta.js`; state +
localStorage into `js/state.js`; PWA glue into `js/pwa.js`. `app.js` stays
the entry module (boot, data loading, view switching). Polish and security
changes layer on top in separate tasks.

**Tech Stack:** Vanilla ES modules, `node --test`, no bundler.

**Voraussetzung:** Teilprojekt 6 ist gemergt (liefert
`vendor/supabase-js-2.110.0.mjs`).

## Global Constraints

- **No behavior change** in the refactor tasks (1–3): extraction is
  move-only plus import/export wiring; no renames, no logic edits.
- `index.html` keeps loading exactly one entry: `<script type="module"
  src="app.js">`.
- Views import from `state`/`standings`/`meta`, never the other way
  around; `app.js` imports everything and passes callbacks down (no
  circular imports).
- localStorage keys stay: `fb_category`, `fb_view`, `fb_cross`,
  `fb_cache`, `fb_rules`, `fb_cautions`.
- All localStorage reads go through `restore(key, fallback)` (try/catch)
  after Task 5.
- `sw.js`: every new file added to `SHELL`, `VERSION` bumped once per
  released task that changes shipped files (final value bumped in Task 8's
  commit is sufficient if deploying once).
- All animations respect `@media (prefers-reduced-motion: reduce)`.
- UI language stays English; visual design (colors, spacing) unchanged
  except where a task explicitly adds styles.

## File Structure

- `js/meta.js` (new) — `FLAGS`, `CODES`, `codeFor`, `flagFor`, `genderOf`,
  `orderIndex`, `esc`, `statusClass`, `isFinished`, `isLive`,
  `CATEGORY_ORDER`, `GROUP_ROUNDS`.
- `js/state.js` (new) — `state` object, `CONFIG`, `persist`, `restore`.
- `js/standings.js` (new) — pure: `matchPointsFor`, `aggregate`,
  `criterionValues`, `breakTies`, `computeStandings`, `groupTeams`,
  `headToHead`, `knockoutMatches`, `knockoutStage`.
- `js/standings.test.mjs` (new).
- `js/views/standings-view.js`, `js/views/bracket-view.js`,
  `js/views/matches-view.js`, `js/views/cards-view.js` (new).
- `js/pwa.js` (new).
- `app.js` (shrinks to orchestrator).
- `supabase-client.js` (vendored import), `index.html` (CSP), `sw.js`,
  `styles.css`, `package.json`.

---

### Task 1: Extract pure standings logic with unit tests

**Files:**
- Create: `js/standings.js`
- Create: `js/standings.test.mjs`
- Modify: `app.js` (delete moved functions, import instead)
- Modify: `package.json` (`test:unit` gains `js/standings.test.mjs`)

**Interfaces:**
- Produces (exports of `js/standings.js`; signatures are the current
  `app.js` ones with explicit parameters instead of `state`/`rules()`
  closures):
  - `matchPointsFor(m, mySets, oppSets, rules): number`
  - `aggregate(teams: string[], matches): Map`
  - `criterionValues(key, teams, games): Map`
  - `breakTies(teams, chain, games): string[]`
  - `computeStandings(matches, category, rules, {groupRounds, isRealTeam}): Row[]|null`
  - `groupTeams(matches, category, {groupRounds, isRealTeam}): string[]`
  - `headToHead(matches, category, t1, t2, groupRounds): match|undefined`
  - `knockoutMatches(matches, category, groupRounds): match[]`
  - `knockoutStage(round: string): {group, key?, title, order?}`

- [ ] **Step 1: Create `js/standings.js` by moving code**

Move from `app.js` lines 79–203 and 296–383 (functions `matchPointsFor`,
`aggregate`, `criterionValues`, `breakTies`, `computeStandings`,
`groupTeams`, `headToHead`, `knockoutMatches`, `knockoutStage`) into
`js/standings.js`, with these mechanical parameter changes (no logic
edits):

- Every internal use of the module-level `rules()` becomes a `rules`
  parameter (`matchPointsFor(m, mySets, oppSets, rules)`;
  `computeStandings` passes it through; `breakTies` gains no rules — it
  already receives the `chain`).
- Every read of `state.matches` becomes a `matches` parameter.
- `GROUP_ROUNDS.includes(...)` becomes a `groupRounds` parameter
  (`computeStandings`/`groupTeams` take `{groupRounds, isRealTeam}` as an
  options object; `headToHead`/`knockoutMatches` take `groupRounds`
  directly).
- `isFinished` is imported nowhere — copy its one-liner into
  `js/standings.js` as a private helper (it is 1 line; `js/meta.js` gets
  the canonical version in Task 2, and this private copy avoids a
  standings→meta dependency for one string comparison):
  `const isFinished = (m) => m.status === "Finished";`

Add file header:

```js
/* Pure tournament math — no DOM, no fetch, no global state.
   Everything takes matches/rules as parameters so it is unit-testable. */
```

- [ ] **Step 2: Write the tests**

Create `js/standings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchPointsFor, breakTies, computeStandings, knockoutStage, groupTeams,
} from './standings.js';

const RULES = {
  drawPoints: 1,
  pointTable: [
    { bestOf: 5, winSets: 3, loseSets: 0, winPts: 3, losePts: 0 },
    { bestOf: 5, winSets: 3, loseSets: 1, winPts: 3, losePts: 0 },
    { bestOf: 5, winSets: 3, loseSets: 2, winPts: 2, losePts: 1 },
  ],
  tiebreakers: ['H2H_SET_DIFF', 'SET_DIFF', 'POINT_DIFF'],
};
const OPTS = { groupRounds: ['Qualification round'], isRealTeam: (n) => !!n && n !== 'TBD' };

const fin = (teamA, teamB, setsA, setsB, pointsA, pointsB) => ({
  category: 'C', round: 'Qualification round', status: 'Finished',
  teamA, teamB, setsA, setsB, pointsA, pointsB, bestOf: 5, sets: [],
});

test('matchPointsFor reads the point table for win and loss sides', () => {
  const m = { bestOf: 5 };
  assert.equal(matchPointsFor(m, 3, 2, RULES), 2);
  assert.equal(matchPointsFor(m, 2, 3, RULES), 1);
  assert.equal(matchPointsFor(m, 3, 0, RULES), 3);
  assert.equal(matchPointsFor(m, 0, 3, RULES), 0);
});

test('matchPointsFor falls back to 2/0 when the table has no row', () => {
  const m = { bestOf: 3 };
  assert.equal(matchPointsFor(m, 2, 1, RULES), 2);
  assert.equal(matchPointsFor(m, 1, 2, RULES), 0);
});

test('matchPointsFor returns drawPoints on equal sets', () => {
  assert.equal(matchPointsFor({ bestOf: 5 }, 1, 1, RULES), 1);
});

test('computeStandings ranks by points, counts W/L and set/point stats', () => {
  const games = [
    fin('A', 'B', 3, 0, 33, 20),
    fin('B', 'C', 3, 2, 45, 40),
    fin('C', 'A', 0, 3, 15, 33),
  ];
  const rows = computeStandings(games, 'C', RULES, OPTS);
  assert.deepEqual(rows.map((r) => r.team), ['A', 'B', 'C']);
  const a = rows[0];
  assert.equal(a.played, 2);
  assert.equal(a.wins, 2);
  assert.equal(a.pts, 6);
  assert.equal(a.setsWon, 6);
  assert.equal(a.setsLost, 0);
});

test('computeStandings returns null for a category without group games', () => {
  assert.equal(computeStandings([], 'C', RULES, OPTS), null);
});

test('computeStandings lists teams from unplayed fixtures with zero rows', () => {
  const games = [{ ...fin('A', 'B', 0, 0, 0, 0), status: 'Not Started' }];
  const rows = computeStandings(games, 'C', RULES, OPTS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].played, 0);
});

test('breakTies resolves a 3-way tie head-to-head and restarts the chain per subgroup', () => {
  // A beats B, B beats C, C beats A — full H2H circle, all equal on
  // H2H_SET_DIFF (each 3:3 in the circle) → falls through to SET_DIFF
  // where D-games differ.
  const games = [
    fin('A', 'B', 3, 0, 33, 11),
    fin('B', 'C', 3, 0, 33, 11),
    fin('C', 'A', 3, 0, 33, 11),
    fin('A', 'D', 3, 2, 40, 38),
    fin('B', 'D', 3, 1, 38, 30),
    fin('C', 'D', 3, 0, 33, 15),
  ];
  const order = breakTies(['A', 'B', 'C'], ['H2H_SET_DIFF', 'SET_DIFF'], games);
  // overall set diffs: A: 6-5=+1? -> A: won 3+3=6? A: vs B +3, vs C -3, vs D +1 => +1
  // B: vs A -3, vs C +3, vs D +2 => +2 ; C: vs B -3, vs A +3, vs D +3 => +3
  assert.deepEqual(order, ['C', 'B', 'A']);
});

test('breakTies falls back to alphabetical when fully tied', () => {
  const order = breakTies(['B', 'A'], ['SET_DIFF'], []);
  assert.deepEqual(order, ['A', 'B']);
});

test('knockoutStage classifies known round labels', () => {
  assert.deepEqual(knockoutStage('Semi-final 1').group, 'tree');
  assert.equal(knockoutStage('Semi-final 1').key, 'sf');
  assert.equal(knockoutStage('Gold Medal Match').key, 'final');
  assert.equal(knockoutStage('Bronze Medal Match').key, 'bronze');
  assert.equal(knockoutStage('4tr Final 2').key, 'qf');
  assert.equal(knockoutStage('Hoffnungsrunde').group, 'list');
  assert.equal(knockoutStage('Placement 5-6').title, '5th place');
  assert.equal(knockoutStage('Something else').title, 'Something else');
});

test('groupTeams collects and sorts group-stage teams, ignoring placeholders', () => {
  const games = [fin('B', 'A', 0, 0, 0, 0), { ...fin('TBD', 'A', 0, 0, 0, 0) }];
  assert.deepEqual(groupTeams(games, 'C', OPTS), ['A', 'B']);
});
```

**Verify the expected values by hand before trusting them** — especially
the `breakTies` circle fixture (the plan's comment shows the arithmetic;
recompute it). If the real implementation disagrees, the *fixture
expectation* is what must be questioned first (behavior anchor: the moved
code is the same code).

- [ ] **Step 3: Run tests**

Run: `node --test js/standings.test.mjs`
Expected: PASS (the logic is unchanged — failures mean a bad move or a bad
fixture expectation; verify by computing by hand).

- [ ] **Step 4: Wire `app.js` to the new module**

In `app.js`, delete the moved functions and add:

```js
import {
  matchPointsFor, aggregate, criterionValues, breakTies, computeStandings,
  groupTeams, headToHead, knockoutMatches, knockoutStage,
} from './js/standings.js';
```

Call sites change mechanically:
- `computeStandings(state.activeCategory)` →
  `computeStandings(state.matches, state.activeCategory, rules(), { groupRounds: GROUP_ROUNDS, isRealTeam })`
- `groupTeams(category)` → `groupTeams(state.matches, category, { groupRounds: GROUP_ROUNDS, isRealTeam })`
- `headToHead(category, t1, t2)` → `headToHead(state.matches, category, t1, t2, GROUP_ROUNDS)`
- `knockoutMatches(category)` → `knockoutMatches(state.matches, category, GROUP_ROUNDS)` (both call sites).

Add `js/standings.test.mjs` to `package.json` `test:unit`.

- [ ] **Step 5: Verify**

Run: `npm run test:unit`
Expected: PASS (incl. existing data-mapping tests).
Serve root (`npx http-server . -p 8080 -c-1`), open the viewer with
production data: standings/bracket/matches/cards render identically.

- [ ] **Step 6: Commit**

```bash
git add js/standings.js js/standings.test.mjs app.js package.json
git commit -m "refactor: extract pure standings logic into js/standings.js with unit tests"
```

---

### Task 2: Extract meta, state, views, and PWA modules

**Files:**
- Create: `js/meta.js`, `js/state.js`, `js/views/standings-view.js`,
  `js/views/bracket-view.js`, `js/views/matches-view.js`,
  `js/views/cards-view.js`, `js/pwa.js`
- Modify: `app.js`, `sw.js`

**Interfaces:**
- `js/meta.js` exports: `FLAGS`, `CODES`, `codeFor`, `flagFor`, `genderOf`,
  `orderIndex`, `esc`, `statusClass`, `isFinished`, `isLive`,
  `CATEGORY_ORDER`, `GROUP_ROUNDS`.
- `js/state.js` exports: `state` (the object literal, unchanged fields),
  `CONFIG`, `persist(key, value)`, `restore(key, fallback)` (Task 5 hardens
  restore; here it is a plain wrapper).
- Views export exactly: `renderStandings()`, `renderBracket()`,
  `renderMatches()`, `renderCards()`, and `matches-view.js` additionally
  `matchCard(m)` (bracket-view imports it for placement rounds).
  `standings-view.js` takes a re-render callback:
  `setStandingsRerender(fn)` — called by the cross-table chip handler
  (today it calls `renderStandings` directly; keep that by exporting and
  self-calling — **no callback needed**, views may import their own module
  functions).
- `js/pwa.js` exports: `initPwa()` — moves the install-prompt +
  service-worker block verbatim.

- [ ] **Step 1: Create `js/meta.js`** — move `FLAGS`, `CODES`, `codeFor`,
  `flagFor`, `genderOf`, `orderIndex`, `esc`, `statusClass`, `isFinished`,
  `isLive`, `CATEGORY_ORDER`, `GROUP_ROUNDS` from `app.js` unchanged
  (the tiny `isRealTeam` wrapper in `app.js` dies; call sites import
  `isRealTeam` from `./data-mapping.js` directly).

- [ ] **Step 2: Create `js/state.js`** (dependency-free)

```js
/* Central mutable state + localStorage persistence for the viewer. */
export const CONFIG = {
  refreshMs: 60000,
};

export function persist(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) {}
}

export function restore(key) {
  return localStorage.getItem(key);
}

export const state = {
  matches: [],
  categories: [],
  activeCategory: restore('fb_category') || null,
  activeView: restore('fb_view') || 'standings',
  matchFilter: 'all',
  crossMode: restore('fb_cross') || 'sets',
  rules: null,
  cautions: [],
  lastUpdated: null,
};
```

All `localStorage.setItem`/`getItem` call sites in `app.js` and views
switch to `persist`/`restore`.

- [ ] **Step 3: Create the four view modules** — move
  `renderStandings`+`renderCrossTable` (standings-view),
  `renderKnockout`+`bracketNode`+`renderBracket` (bracket-view),
  `renderMatches`+`renderMatchFilter`+`matchPassesFilter`+`matchCard`
  (matches-view), `renderCards`+`cautionBadge` (cards-view). Each imports
  what it needs from `../state.js`, `../standings.js`, `../meta.js`
  (paths relative to `js/views/`: `../state.js` etc. — `data-mapping.js`
  sits in the root: `../../data-mapping.js`). The `$` helper
  (`document.getElementById`) is 1 line — copy it into each view that uses
  it. `renderStandings`'s chip handler calls its own module's
  `renderStandings` (same-module reference, no import cycle).

- [ ] **Step 4: Create `js/pwa.js`** — move the PWA-install block, the
  service-worker registration block, and `showUpdateToast` verbatim into
  an exported `initPwa()`; `app.js` calls `initPwa()` at boot.

- [ ] **Step 5: Slim `app.js`** — what remains: imports, `rules()`,
  `setCategory`, `setView`, `renderActiveView`, `renderCategories`,
  `load`, `applyData`, `cacheData`, `showBanner`, boot wiring (tab/refresh
  handlers, initial cache paint, interval, visibility listener),
  `initPwa()` call. Expected size ≈ 200 lines.

- [ ] **Step 6: Update `sw.js`** — add to `SHELL`:
  `./js/meta.js`, `./js/state.js`, `./js/standings.js`, `./js/pwa.js`,
  `./js/views/standings-view.js`, `./js/views/bracket-view.js`,
  `./js/views/matches-view.js`, `./js/views/cards-view.js`.
  Delete the dead `docs.google.com` bypass (lines 36–37). Bump `VERSION`.

- [ ] **Step 7: Verify**

Run: `npm run test:unit` — PASS.
Manual: serve root, hard-reload viewer, click through all 4 views, both
cross-table modes, a category with bracket. Check the console for import
errors. Then verify the SW update toast appears for a returning client
(load once, bump nothing — the VERSION bump from this task triggers it).

- [ ] **Step 8: Commit**

```bash
git add js/ app.js sw.js
git commit -m "refactor: split viewer app.js into state/meta/views/pwa modules"
```

---

### Task 3: Vendored supabase-js + CSP + escaping audit

**Files:**
- Modify: `supabase-client.js:1`, `index.html`, `js/views/matches-view.js`, `sw.js`

- [ ] **Step 1: Switch the import**

`supabase-client.js` line 1:

```js
// old
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// new
import { createClient } from './vendor/supabase-js-2.110.0.mjs';
```

- [ ] **Step 2: Add CSP meta to `index.html`**

In `<head>` (after the charset/viewport tags):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://obujvbiwqspdnewetgyi.supabase.co; img-src 'self' data:; style-src 'self'; base-uri 'none'; object-src 'none'">
```

- [ ] **Step 3: Escaping audit**

Run: `grep -n '\${' js/views/*.js app.js | grep -v 'esc(\|escapeHtml('`
and check each hit. Known fix in `matches-view.js` `matchCard`:

```js
// old
<span class="tag">#${m.nr}</span>
// new
<span class="tag">#${esc(m.nr)}</span>
```

Rule: every interpolation of DB/cache-sourced values goes through `esc()`;
numeric computed values (`m.setsA`, counts) may stay bare only when they
are produced by arithmetic in our own code, not passed through from data.
(`m.nr`, `m.time`, `m.day`, `m.court`, `m.round`, `m.status`, team names,
player names, event types: **always `esc()`**.)

- [ ] **Step 4: Add vendor file to SW shell**

`sw.js` `SHELL` gains `./vendor/supabase-js-2.110.0.mjs`; bump `VERSION`.

- [ ] **Step 5: Verify offline**

Serve root, load the viewer once (SW installs). DevTools → Network →
Offline → hard reload: **the app now starts offline** (previously the
esm.sh import killed it) and shows cached data + the offline banner.
Console: no CSP violations online.

- [ ] **Step 6: Commit**

```bash
git add supabase-client.js index.html js/views/matches-view.js sw.js
git commit -m "feat: vendored supabase-js, CSP and escaping audit for the viewer"
```

---

### Task 4: Robust cache parsing (`restore` with JSON + fallback)

**Files:**
- Create: `js/state.test.mjs`
- Modify: `js/state.js`, `app.js`
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- `js/state.js` gains `restoreJson(key, fallback)`; plain-string
  `restore(key)` stays for `fb_category`/`fb_view`/`fb_cross`.

- [ ] **Step 1: Write failing tests**

Create `js/state.test.mjs`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stub for node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { persist, restoreJson } = await import('./state.js');

beforeEach(() => store.clear());

test('restoreJson round-trips a persisted object', () => {
  persist('k', { a: 1 });
  assert.deepEqual(restoreJson('k', null), { a: 1 });
});

test('restoreJson returns the fallback for a missing key', () => {
  assert.equal(restoreJson('missing', 'fb'), 'fb');
});

test('restoreJson returns the fallback for corrupt JSON instead of throwing', () => {
  store.set('bad', '{not json');
  assert.deepEqual(restoreJson('bad', []), []);
});
```

Run: `node --test js/state.test.mjs` — FAIL (`restoreJson` not exported).

- [ ] **Step 2: Implement**

Add to `js/state.js`:

```js
export function restoreJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}
```

Replace in `app.js` every `JSON.parse(localStorage.getItem(...))`-shaped
read:
- `load()` error path: `state.rules = restoreJson('fb_rules', DEFAULT_RULES);`
  (replaces the unguarded `cachedRules ? JSON.parse(cachedRules) : DEFAULT_RULES`)
- cautions fallback: `state.cautions = restoreJson('fb_cautions', []);`
- boot cache paint:
  `const boot = restoreJson('fb_cache', null); if (boot) applyData(boot);`
- offline fallback in `load()`:
  `const cached = restoreJson('fb_cache', null); if (cached && !state.matches.length) applyData(cached);`

- [ ] **Step 3: Run tests**

Run: `node --test js/state.test.mjs` — PASS. Add the file to `test:unit`;
`npm run test:unit` green.

- [ ] **Step 4: Commit**

```bash
git add js/state.js js/state.test.mjs app.js package.json
git commit -m "feat: harden viewer cache parsing with restoreJson fallback"
```

---

### Task 5: Skeleton loaders

**Files:**
- Modify: `index.html`, `styles.css`, `app.js`

- [ ] **Step 1: Replace the loading element**

`index.html`: replace `<div id="loading" class="loading">Loading results…</div>`
with:

```html
<div id="loading" class="loading" aria-label="Loading results">
  <div class="skeleton skeleton-bar"></div>
  <div class="skeleton skeleton-table"></div>
  <div class="skeleton skeleton-card"></div>
  <div class="skeleton skeleton-card"></div>
</div>
```

- [ ] **Step 2: Styles**

Append to `styles.css`:

```css
/* Skeleton loading state (first load without cache) */
.loading { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; }
.skeleton {
  border-radius: 10px;
  background: linear-gradient(90deg, var(--bg-elev) 25%, var(--bg-elev-2) 50%, var(--bg-elev) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
}
.skeleton-bar { height: 34px; width: 60%; }
.skeleton-table { height: 220px; }
.skeleton-card { height: 88px; }
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}
```

- [ ] **Step 3: Verify hide-path** — `applyData()` already sets
  `$("loading").hidden = true;`; confirm `[hidden]` wins over
  `display: flex` by adding to `styles.css`:

```css
.loading[hidden] { display: none; }
```

Also unify the empty states with a subtle icon (spec item), appended to
`styles.css`:

```css
.empty::before { content: "◇"; display: block; font-size: 20px; opacity: 0.5; margin-bottom: 6px; }
```

Manual check: DevTools → Application → clear storage → reload: skeletons
shimmer until data lands; with cache present, content paints instantly
(no skeleton flash).

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: skeleton loaders for the viewer first load"
```

---

### Task 6: A11y pass (tabs, pills, focus, reduced motion, contrast)

**Files:**
- Modify: `index.html`, `app.js`, `js/views/matches-view.js`, `styles.css`

- [ ] **Step 1: Tabs** — `index.html` already has `role="tablist"`/
  `role="tab"`. In `app.js` `setView()`, alongside each
  `classList.toggle('is-active', …)` add
  `el.setAttribute('aria-selected', String(view === '<name>'))` — concretely,
  refactor the four hardcoded toggles into:

```js
const TABS = [
  ['tabStandings', 'standings', 'standingsView'],
  ['tabBracket', 'bracket', 'bracketView'],
  ['tabMatches', 'matches', 'matchesView'],
  ['tabCards', 'cards', 'cardsView'],
];
for (const [tabId, name, viewId] of TABS) {
  const active = view === name;
  const tab = $(tabId);
  tab.classList.toggle('is-active', active);
  tab.setAttribute('aria-selected', String(active));
  $(viewId).hidden = !active;
}
```

- [ ] **Step 2: Pills & chips** — in `renderCategories` (app.js) set
  `b.setAttribute('aria-pressed', String(cat === state.activeCategory))`;
  in `renderMatchFilter` and the cross-table toggle add
  `aria-pressed="${active}"` into the chip template strings.

- [ ] **Step 3: Focus + motion + contrast** — append to `styles.css`:

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .live-dot { animation: none; }
  * { transition-duration: 0.01ms !important; }
}
```

Contrast fixes: `.event-sub` drops `opacity: 0.8` (full `--muted` color is
≈7:1 on `--bg`, the extra opacity pushed it under 4.5:1). Check `.updated`
and `.tag` similarly — they use `--muted` without opacity, fine.

- [ ] **Step 4: Verify** — keyboard-tab through header, pills, tabs,
  chips: visible focus ring everywhere; VoiceOver/devtools accessibility
  tree shows selected states.

- [ ] **Step 5: Commit**

```bash
git add index.html app.js js/views/matches-view.js styles.css
git commit -m "feat: viewer a11y pass (aria states, focus rings, reduced motion, contrast)"
```

---

### Task 7: Mobile navigation (sticky tabs, pill scroll-snap) + view fade

**Files:**
- Modify: `styles.css`, `app.js`

- [ ] **Step 1: Sticky view tabs**

```css
.view-tabs {
  position: sticky;
  top: 0; /* sits below the sticky header because the header is a separate stacking context in flow — measure and use its computed height */
  z-index: 15;
  background: var(--bg);
}
```

The header is `position: sticky; top: 0` itself, so the tabs must stick
below it: give the tabs `top: var(--header-h, 64px)` and set the variable
once in `app.js` boot:

```js
document.documentElement.style.setProperty(
  '--header-h', `${document.querySelector('.app-header').offsetHeight}px`);
```

(Recompute on `resize` with a passive listener.)

- [ ] **Step 2: Pill rows scroll-snap**

```css
.cat-row-pills {
  display: flex; gap: 8px; overflow-x: auto;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch; scrollbar-width: none;
}
.cat-row-pills::-webkit-scrollbar { display: none; }
.cat-row-pills .pill { scroll-snap-align: start; flex: none; }
```

(Check against the existing `.cat-row`/`.category-pills` rules in
`styles.css` and merge rather than duplicate — the selectors above must
match the DOM `renderCategories` builds: `.cat-row > .cat-row-pills > .pill`.)

In `renderCategories`, after building the rows, keep the active pill
visible:

```js
wrap.querySelector('.pill.is-active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
```

- [ ] **Step 3: View fade**

```css
.view { animation: viewfade 0.12s ease-out; }
@keyframes viewfade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .view { animation: none; } }
```

- [ ] **Step 4: Verify at 390px** — tabs stay visible while scrolling a
  long match list; pills swipe horizontally and snap; switching categories
  scrolls the active pill into view; view switch fades briefly.

- [ ] **Step 5: Commit**

```bash
git add styles.css app.js
git commit -m "feat: sticky view tabs, pill scroll-snap and view fade for mobile"
```

---

### Task 8: Final verification

- [ ] **Step 1: Full unit suite** — `npm run test:unit` green.
- [ ] **Step 2: `sw.js` audit** — `SHELL` contains: `./`, `./index.html`,
  `./styles.css`, `./app.js`, `./supabase-client.js`, `./data-mapping.js`,
  all 8 `js/` modules, `./vendor/supabase-js-2.110.0.mjs`, manifest+icons
  (whatever was listed before stays). `VERSION` bumped once more for the
  release.
- [ ] **Step 3: Manual checklist** (desktop + 390px):
  - all 4 views with production data — identical numbers to pre-refactor,
  - offline hard-reload works fully (vendored module cached),
  - update toast on version bump,
  - no CSP violations, no console errors,
  - skeletons only on cold start,
  - keyboard navigation with visible focus.
- [ ] **Step 4: Commit any stragglers**

```bash
git add -A
git commit -m "chore: final sw shell audit for viewer refactor release"
```
