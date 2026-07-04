# Teilprojekt 8: Viewer Live-Tab, Spieldetails & Ticker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-category Live tab (by time / by court), a tap-to-open
match-detail bottom sheet, and live-ticker affordances (live group first,
score pulse, live dot on the tab) to the public viewer.

**Architecture:** Selection logic is pure (`js/live-select.js`, unit
tested); the Live tab is a fifth view module (`js/views/live-view.js`)
following the Task-7 module pattern. The detail sheet is a single reusable
DOM container driven by `js/match-detail.js`, opened via event delegation
on `data-match-id` attributes that `matchCard` now emits. Score-pulse
diffing runs in `applyData()` against the previous state.

**Tech Stack:** Vanilla ES modules, `node --test`, no new dependencies.

**Voraussetzung:** Teilprojekt 7 ist gemergt (Modulstruktur `js/`,
`js/views/*`, `persist`/`restoreJson`, vendored supabase-js, CSP).

## Global Constraints

- UI language English: tab label `Live`, sections `Live now` / `Up next`,
  toggle `By time` / `By court`, sheet close label `Close`.
- The Live tab is cross-category: category pills hidden while it is
  active (`.category-bar` gets `hidden`), restored on any other tab.
- First-time visitors (no stored `fb_view`) land on `live`; returning
  visitors keep their stored view.
- New localStorage key: `fb_live_mode` (`'time'` | `'court'`), via
  `persist`/`restore` from `js/state.js`.
- `matchCard(m, { showCategory })` is the only card renderer — no
  duplicate card markup for the Live tab.
- All DB-sourced strings through `esc()`; no inline handlers (CSP).
- Polling unchanged (60 s + visibility). The only possible new query is
  referee assignments, and only if `anon` can already read them (checked
  in Task 4; **no RLS changes** in any case).
- Animations respect `prefers-reduced-motion`.
- `sw.js` `SHELL` gains every new file; `VERSION` bumped for release.

## File Structure

- `js/live-select.js` (new, pure) — `selectLive`, `selectUpNext`,
  `groupByCourt`, `changedMatchIds`.
- `js/live-select.test.mjs` (new).
- `js/views/live-view.js` (new) — `renderLive()`.
- `js/match-detail.js` (new) — `initMatchDetail()`,
  `refreshMatchDetail()`, `closeMatchDetail()` (opening is private, via
  delegation).
- `js/views/matches-view.js` (modified) — `matchCard` options + live
  group.
- `data-mapping.js` + `data-mapping.test.mjs` (modified) — match id on
  caution events.
- `supabase-client.js` (modified, conditional) — `fetchRefereeAssignments`.
- `app.js`, `index.html`, `styles.css`, `sw.js`, `package.json`.

---

### Task 1: Match id on caution events (`data-mapping.js`)

**Files:**
- Modify: `data-mapping.js` (`mapCautions`)
- Modify: `data-mapping.test.mjs`

**Interfaces:**
- Caution event objects become `{game, type, matchId}` (was `{game,
  type}`) — `js/match-detail.js` filters on `matchId` in Task 4.

- [ ] **Step 1: Extend the tests**

In `data-mapping.test.mjs`, find the existing `mapCautions` tests and add
to the fixture rows a `match_id` field (mirroring what the query already
selects — check `fetchCautions` in `supabase-client.js`; the
`player_events` rows carry `match_id`; if the current select list omits
it, Task 1 also adds `match_id` to that select). New assertion in the
aggregation test:

```js
assert.equal(players[0].events[0].matchId, 'match-1');
```

Run: `node --test data-mapping.test.mjs` — the new assertion FAILS.

- [ ] **Step 2: Implement**

In `mapCautions`, where events are collected (the `events.push({ game,
type })` site), add the id:

```js
events.push({ game, type, matchId: row.match_id ?? null });
```

If `fetchCautions`'s `.select(...)` string lacks `match_id`, add it.

- [ ] **Step 3: Run tests** — `node --test data-mapping.test.mjs` PASS;
  `npm run test:unit` green.

- [ ] **Step 4: Commit**

```bash
git add data-mapping.js data-mapping.test.mjs supabase-client.js
git commit -m "feat: carry match id on caution events for match detail view"
```

---

### Task 2: Pure live-selection module

**Files:**
- Create: `js/live-select.js`, `js/live-select.test.mjs`
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- `selectLive(matches): match[]` — all matches with live status, input
  order preserved.
- `selectUpNext(matches, n): match[]` — first `n` with status
  `"Not Started"`, input order preserved (input is already sorted by
  `scheduled_time`).
- `groupByCourt(matches): {court: string|null, live: match[], upNext:
  match[]}[]` — one entry per distinct court sorted by court name
  (numeric-aware via `localeCompare(..., undefined, {numeric: true})`),
  `upNext` capped at 2 per court; a trailing entry with `court: null`
  collects courtless live/up-next matches only if any exist.
- `changedMatchIds(oldMatches, newMatches): Set<id>` — ids whose
  `setsA/setsB/pointsA/pointsB/status` differ; ids only present in one
  list are ignored (no pulse for appearing/disappearing fixtures).
- Matches are the `mapMatch` shape; live/not-started checks are the same
  string comparisons as `js/meta.js` (`"In progress"`/`"Starting"` live,
  `"Not Started"` upcoming) — import `isLive` from `./meta.js`.

- [ ] **Step 1: Write failing tests**

Create `js/live-select.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLive, selectUpNext, groupByCourt, changedMatchIds } from './live-select.js';

const m = (id, status, court, extra = {}) => ({
  id, status, court, category: 'C', teamA: 'A', teamB: 'B',
  setsA: 0, setsB: 0, pointsA: 0, pointsB: 0, ...extra,
});

test('selectLive keeps only live matches in input order', () => {
  const list = [m(1, 'Finished'), m(2, 'In progress'), m(3, 'Starting'), m(4, 'Not Started')];
  assert.deepEqual(selectLive(list).map((x) => x.id), [2, 3]);
});

test('selectUpNext takes the first n scheduled matches', () => {
  const list = [m(1, 'Not Started'), m(2, 'Finished'), m(3, 'Not Started'), m(4, 'Not Started')];
  assert.deepEqual(selectUpNext(list, 2).map((x) => x.id), [1, 3]);
});

test('groupByCourt sorts courts numerically and caps upNext at 2', () => {
  const list = [
    m(1, 'In progress', '10'), m(2, 'In progress', '2'),
    m(3, 'Not Started', '2'), m(4, 'Not Started', '2'), m(5, 'Not Started', '2'),
  ];
  const groups = groupByCourt(list);
  assert.deepEqual(groups.map((g) => g.court), ['2', '10']);
  assert.deepEqual(groups[0].live.map((x) => x.id), [2]);
  assert.deepEqual(groups[0].upNext.map((x) => x.id), [3, 4]);
});

test('groupByCourt appends a null-court group only when needed', () => {
  assert.deepEqual(groupByCourt([m(1, 'In progress', '1')]).map((g) => g.court), ['1']);
  const withNull = groupByCourt([m(1, 'In progress', '1'), m(2, 'Not Started', '')]);
  assert.deepEqual(withNull.map((g) => g.court), ['1', null]);
});

test('groupByCourt ignores finished matches entirely', () => {
  assert.deepEqual(groupByCourt([m(1, 'Finished', '1')]), []);
});

test('changedMatchIds flags score/status changes, ignores add/remove', () => {
  const before = [m(1, 'In progress', '1', { setsA: 1 }), m(2, 'Not Started', '1'), m(3, 'Finished', '1')];
  const after = [m(1, 'In progress', '1', { setsA: 2 }), m(2, 'In progress', '1'), m(4, 'Not Started', '1')];
  const ids = changedMatchIds(before, after);
  assert.deepEqual([...ids].sort(), [1, 2]);
});
```

Run: `node --test js/live-select.test.mjs` — FAIL (module missing).

- [ ] **Step 2: Implement `js/live-select.js`**

```js
/* Pure selection logic for the Live tab and the score-pulse diff. */
import { isLive } from './meta.js';

export function selectLive(matches) {
  return matches.filter(isLive);
}

export function selectUpNext(matches, n) {
  return matches.filter((m) => m.status === 'Not Started').slice(0, n);
}

export function groupByCourt(matches) {
  const byCourt = new Map();
  const ensure = (court) => {
    if (!byCourt.has(court)) byCourt.set(court, { court, live: [], upNext: [] });
    return byCourt.get(court);
  };
  for (const m of matches) {
    const court = m.court ? String(m.court) : null;
    if (isLive(m)) ensure(court).live.push(m);
    else if (m.status === 'Not Started') {
      const g = ensure(court);
      if (g.upNext.length < 2) g.upNext.push(m);
    }
  }
  const named = [...byCourt.values()].filter((g) => g.court !== null)
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));
  const nullGroup = byCourt.get(null);
  return nullGroup ? [...named, nullGroup] : named;
}

export function changedMatchIds(oldMatches, newMatches) {
  const prev = new Map(oldMatches.map((m) => [m.id, m]));
  const changed = new Set();
  for (const m of newMatches) {
    const p = prev.get(m.id);
    if (!p) continue;
    if (p.setsA !== m.setsA || p.setsB !== m.setsB ||
        p.pointsA !== m.pointsA || p.pointsB !== m.pointsB ||
        p.status !== m.status) changed.add(m.id);
  }
  return changed;
}
```

**Note:** `mapMatch` objects need an `id` — check `data-mapping.js`; if
`mapMatch` drops the row id, add `id: row.id` to its output and to its
tests (one assertion: `assert.equal(m.id, 'match-uuid-1')`).

- [ ] **Step 3: Run tests** — PASS; add file to `test:unit`; suite green.

- [ ] **Step 4: Commit**

```bash
git add js/live-select.js js/live-select.test.mjs data-mapping.js data-mapping.test.mjs package.json
git commit -m "feat: pure live-tab selection and score-diff module"
```

---

### Task 3: Live tab view

**Files:**
- Create: `js/views/live-view.js`
- Modify: `index.html`, `app.js`, `js/views/matches-view.js`,
  `styles.css`, `sw.js`

**Interfaces:**
- `matchCard(m, opts?)` gains `opts = { showCategory: false }`; when true
  the meta row prepends `<span class="tag tag--cat">${esc(m.category)}</span>`.
  All existing callers stay valid (single-argument calls).
- `live-view.js` exports `renderLive()`; reads `state.matches`,
  `restore('fb_live_mode')`.
- `app.js` view tables gain the `live` entry; `setView('live')` hides
  `.category-bar`.

- [ ] **Step 1: `index.html`** — add the tab as the first tablist entry
  and the view section:

```html
<button id="tabLive" class="view-tab" role="tab">Live</button>
```

```html
<section id="liveView" class="view" hidden>
  <div id="live"></div>
</section>
```

- [ ] **Step 2: `matchCard` option** — in `js/views/matches-view.js`:

```js
export function matchCard(m, { showCategory = false } = {}) {
  ...
  <div class="match-meta">
    ${showCategory ? `<span class="tag tag--cat">${esc(m.category)}</span>` : ""}
    <span>${esc(m.time)}</span>
    ...
```

(Everything else in the function unchanged.)

- [ ] **Step 3: Create `js/views/live-view.js`**

```js
import { state, persist, restore } from '../state.js';
import { esc } from '../meta.js';
import { selectLive, selectUpNext, groupByCourt } from '../live-select.js';
import { matchCard } from './matches-view.js';

const $ = (id) => document.getElementById(id);
const UP_NEXT_COUNT = 6;

function mode() {
  return restore('fb_live_mode') === 'court' ? 'court' : 'time';
}

function section(title, cards, extraClass = '') {
  if (!cards.length) return '';
  return `<p class="section-title ${extraClass}">${esc(title)}</p>${cards.join('')}`;
}

export function renderLive() {
  const host = $('live');
  const card = (m) => matchCard(m, { showCategory: true });
  const toggle = `
    <div class="cross-bar">
      <p class="section-title">Across all categories</p>
      <div class="cross-toggle">
        <button class="chip ${mode() === 'time' ? 'is-active' : ''}" data-live-mode="time" aria-pressed="${mode() === 'time'}">By time</button>
        <button class="chip ${mode() === 'court' ? 'is-active' : ''}" data-live-mode="court" aria-pressed="${mode() === 'court'}">By court</button>
      </div>
    </div>`;

  let body = '';
  if (mode() === 'time') {
    const live = selectLive(state.matches).map(card);
    const next = selectUpNext(state.matches, UP_NEXT_COUNT).map(card);
    body = section('Live now', live) + section('Up next', next, 'sub');
    if (!live.length && !next.length) {
      body = `<div class="empty">No live or upcoming matches right now — see <b>Matches</b> for full results.</div>`;
    }
  } else {
    const groups = groupByCourt(state.matches);
    if (!groups.length) {
      body = `<div class="empty">No live or upcoming matches right now — see <b>Matches</b> for full results.</div>`;
    }
    for (const g of groups) {
      const title = g.court === null ? 'No court assigned' : `Court ${g.court}`;
      body += section(title, [...g.live.map(card), ...g.upNext.map(card)], 'sub');
    }
  }

  host.innerHTML = toggle + body;
  host.querySelectorAll('[data-live-mode]').forEach((b) => {
    b.onclick = () => { persist('fb_live_mode', b.dataset.liveMode); renderLive(); };
  });
}
```

- [ ] **Step 4: Wire `app.js`**

- The `TABS` table (from Teilprojekt 7 Task 6) gains
  `['tabLive', 'live', 'liveView']` as its first row; `$("tabLive").onclick
  = () => setView("live");`
- `renderActiveView()`: `if (state.activeView === "live") return renderLive();`
  **before** the `if (!state.activeCategory) return;` guard (live is
  category-independent, like cards).
- `setView()` additionally toggles the pills:
  `document.querySelector(".category-bar").hidden = view === "live";`
- Default view for first-timers — in `js/state.js` the initializer
  becomes: `activeView: restore('fb_view') || 'live',`
- `renderLive` import in `app.js`:
  `import { renderLive } from './js/views/live-view.js';`

- [ ] **Step 5: Styles** — append to `styles.css`:

```css
.tag--cat { color: var(--accent); border-color: rgba(79, 140, 255, 0.4); }
```

(Verify `.tag` is a bordered chip in the existing sheet; if it has no
border property, use `background: rgba(79, 140, 255, 0.12);` instead —
match the existing `.tag` construction.)

- [ ] **Step 6: `sw.js`** — `SHELL` gains `./js/live-select.js`,
  `./js/views/live-view.js`; bump `VERSION`.

- [ ] **Step 7: Verify** — unit suite green; manual: Live tab first in
  the row, default for a fresh profile (incognito), pills hidden on Live,
  both modes render with production data, toggle persists across reloads.

- [ ] **Step 8: Commit**

```bash
git add index.html app.js js/views/live-view.js js/views/matches-view.js styles.css sw.js js/state.js
git commit -m "feat: cross-category Live tab with time and court grouping"
```

---

### Task 4: Match-detail bottom sheet

**Files:**
- Create: `js/match-detail.js`
- Modify: `index.html`, `js/views/matches-view.js`, `app.js`,
  `styles.css`, `supabase-client.js` (conditional), `sw.js`

**Interfaces:**
- `matchCard` root div gains `data-match-id="${esc(m.id)}"`,
  `role="button"`, `tabindex="0"`.
- `js/match-detail.js` exports:
  - `initMatchDetail()` — reads `state` directly; wires click/keydown
    delegation on `main.content` (see Step 3), backdrop/ESC/✕ closing.
  - `refreshMatchDetail()` — re-renders the open sheet from current state
    (called at the end of `applyData()`).
- Referees (conditional): `fetchRefereeAssignments(matchIds)` in
  `supabase-client.js` returning
  `[{match_id, role, referee: {name}}]`, stored as
  `state.referees` (Map matchId → list) — **only if the RLS probe
  passes**.

- [ ] **Step 1: RLS probe (decides the referee line)**

Run against production with the anon key (values from
`supabase-client.js`):

```bash
curl -s "https://obujvbiwqspdnewetgyi.supabase.co/rest/v1/referee_assignments?select=role,referee:referee_id(name)&limit=1" \
  -H "apikey: <SUPABASE_ANON_KEY from supabase-client.js>" \
  -H "Authorization: Bearer <same key>"
```

- HTTP 200 with rows (or `[]`) → anon can read: **include** the referee
  feature below.
- HTTP 401/403/permission error → **skip** every referee step in this
  task (the sheet simply has no referee line) and note it in the commit
  message.

- [ ] **Step 2: Sheet container in `index.html`** (before the closing
  `</body>`):

```html
<div id="matchSheet" class="sheet-backdrop" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Match details">
    <button id="sheetClose" class="icon-btn sheet-close" aria-label="Close">✕</button>
    <div id="sheetBody"></div>
  </div>
</div>
```

- [ ] **Step 3: Implement `js/match-detail.js`**

```js
import { state } from './state.js';
import { esc, flagFor, statusClass, isFinished } from './meta.js';

const $ = (id) => document.getElementById(id);
let openMatchId = null;
let lastTrigger = null;

function sheetHtml(m) {
  const setRows = m.sets.map(([a, b], i) => `
    <tr>
      <td class="dim">Set ${i + 1}</td>
      <td class="${a > b ? 'won' : ''}">${a}</td>
      <td class="${b > a ? 'won' : ''}">${b}</td>
    </tr>`).join('');

  const cards = (state.cautions || [])
    .flatMap((p) => p.events
      .filter((e) => e.matchId === m.id)
      .map((e) => ({ name: ((p.first ? p.first + ' ' : '') + p.name).trim(), team: p.teamName, type: e.type })));
  const cardRows = cards.map((c) =>
    `<div class="sheet-card-row"><span class="badge ${c.type.toLowerCase()}">${esc(c.type)}</span> ${esc(c.name)} <span class="dim">· ${esc(c.team)}</span></div>`).join('');

  const refs = state.referees?.get?.(m.id) || [];
  const refLine = refs.length
    ? `<p class="sheet-meta">Referees: ${refs.map((r) => `${esc(r.role)}: ${esc(r.referee?.name ?? '?')}`).join(', ')}</p>`
    : '';

  return `
    <p class="sheet-meta">${esc(m.category)} · ${esc(m.round)} · #${esc(m.nr)}
      <span class="status ${statusClass(m.status)}">${esc(m.status)}</span></p>
    <div class="sheet-teams">
      <div class="sheet-team"><span class="flag">${flagFor(m.teamA)}</span> ${esc(m.teamA)}
        <span class="sheet-sets ${isFinished(m) && m.setsA > m.setsB ? 'win' : ''}">${m.setsA}</span></div>
      <div class="sheet-team"><span class="flag">${flagFor(m.teamB)}</span> ${esc(m.teamB)}
        <span class="sheet-sets ${isFinished(m) && m.setsB > m.setsA ? 'win' : ''}">${m.setsB}</span></div>
    </div>
    ${m.sets.length ? `<table class="sheet-set-table"><tbody>${setRows}</tbody></table>` : ''}
    <p class="sheet-meta">${esc(m.day || '')} ${esc(m.time || '')}${m.court ? ` · Court ${esc(m.court)}` : ''}</p>
    ${refLine}
    ${cardRows ? `<p class="section-title sub">Cards</p>${cardRows}` : ''}
  `;
}

function open(matchId, trigger) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m) return;
  openMatchId = matchId;
  lastTrigger = trigger || null;
  $('sheetBody').innerHTML = sheetHtml(m);
  $('matchSheet').hidden = false;
  document.body.style.overflow = 'hidden';
  $('sheetClose').focus();
}

export function closeMatchDetail() {
  if (openMatchId === null) return;
  openMatchId = null;
  $('matchSheet').hidden = true;
  document.body.style.overflow = '';
  lastTrigger?.focus?.();
  lastTrigger = null;
}

export function refreshMatchDetail() {
  if (openMatchId === null) return;
  const m = state.matches.find((x) => x.id === openMatchId);
  if (!m) { closeMatchDetail(); return; }
  $('sheetBody').innerHTML = sheetHtml(m);
}

export function initMatchDetail() {
  document.querySelector('main.content').addEventListener('click', (e) => {
    const card = e.target.closest('[data-match-id]');
    if (card) open(card.dataset.matchId, card);
  });
  document.querySelector('main.content').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-match-id]');
    if (card) { e.preventDefault(); open(card.dataset.matchId, card); }
  });
  $('sheetClose').onclick = closeMatchDetail;
  $('matchSheet').onclick = (e) => { if (e.target === $('matchSheet')) closeMatchDetail(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMatchDetail(); });
}
```

- [ ] **Step 4: `matchCard` root** — in `js/views/matches-view.js`:

```js
// old
<div class="match ${live ? "live" : ""}">
// new
<div class="match ${live ? "live" : ""}" data-match-id="${esc(m.id)}" role="button" tabindex="0">
```

- [ ] **Step 5: Wire `app.js`** — boot: `initMatchDetail();`
  end of `applyData()`: `refreshMatchDetail();`
  If the Step-1 probe passed, extend `load()`:

```js
const [cauR, refR] = await Promise.allSettled([
  fetchCautions(matchIds),
  fetchRefereeAssignments(matchIds),
]);
...
if (refR.status === 'fulfilled') {
  state.referees = new Map();
  for (const a of refR.value) {
    if (!state.referees.has(a.match_id)) state.referees.set(a.match_id, []);
    state.referees.get(a.match_id).push(a);
  }
}
```

with in `supabase-client.js`:

```js
export async function fetchRefereeAssignments(matchIds) {
  if (!matchIds.length) return [];
  const { data, error } = await client
    .from('referee_assignments')
    .select('match_id, role, referee:referee_id(name)')
    .in('match_id', matchIds);
  if (error) throw error;
  return data;
}
```

- [ ] **Step 6: Styles** — append to `styles.css`:

```css
/* Match-detail sheet */
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(4, 8, 16, 0.65);
  display: grid; place-items: end center;
}
.sheet-backdrop[hidden] { display: none; }
.sheet {
  position: relative;
  background: var(--bg-elev); border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow);
  width: min(560px, 100%);
  max-height: 85dvh; overflow-y: auto;
  padding: 20px 16px calc(16px + env(safe-area-inset-bottom));
  animation: sheetup 0.18s ease-out;
}
@keyframes sheetup { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
@media (min-width: 700px) {
  .sheet-backdrop { place-items: center; }
  .sheet { border-radius: var(--radius); }
}
.sheet-close { position: absolute; top: 10px; right: 10px; }
.sheet-meta { color: var(--muted); font-size: 13px; margin: 4px 0; }
.sheet-teams { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.sheet-team { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; }
.sheet-sets { margin-left: auto; font-size: 24px; font-weight: 800; color: var(--muted); }
.sheet-sets.win { color: var(--accent-2); }
.sheet-set-table { width: auto; }
.sheet-set-table td { padding: 3px 12px 3px 0; border: none; }
.sheet-set-table td.won { color: var(--accent-2); font-weight: 700; }
.sheet-card-row { font-size: 14px; padding: 3px 0; }
.match[data-match-id] { cursor: pointer; }
```

(`.badge`, `.status`, `.flag`, `.dim`, `.section-title` already exist.)

- [ ] **Step 7: `sw.js`** — `SHELL` gains `./js/match-detail.js`; bump
  `VERSION`.

- [ ] **Step 8: Verify** — manual: open from Live/Matches/Bracket
  placement cards (tap + Enter key); ESC/backdrop/✕ close and focus
  returns to the card; body doesn't scroll behind; leave a sheet open
  over a refresh (or trigger `load(true)`) — content re-renders, and a
  vanished match closes it. Cards section shows only that match's cards.

- [ ] **Step 9: Commit**

```bash
git add js/match-detail.js js/views/matches-view.js index.html app.js styles.css sw.js supabase-client.js
git commit -m "feat: match-detail bottom sheet with sets, cards and optional referees"
```

---

### Task 5: Ticker feel (live group, score pulse, tab dot)

**Files:**
- Modify: `js/views/matches-view.js`, `app.js`, `index.html`,
  `styles.css`

**Interfaces:**
- Consumes `changedMatchIds` (Task 2).
- `applyData()` exposes the diff via a module-level
  `let lastChangedIds = new Set();` in `app.js`, passed to the render pass
  (see Step 2).

- [ ] **Step 1: Live group in the Matches tab**

In `renderMatches()` (js/views/matches-view.js), before the day-group
build, prepend a live section (highlight, not re-sort — matches stay in
their day groups too):

```js
const liveNow = list.filter(isLive);
const liveHtml = liveNow.length
  ? `<div class="day-group"><div class="day-head">● Live</div>${liveNow.map((m) => matchCard(m)).join('')}</div>`
  : '';
host.innerHTML = liveHtml + groups.map(...unchanged...).join('');
```

- [ ] **Step 2: Score pulse**

`app.js` `applyData()`, first lines:

```js
import { changedMatchIds } from './js/live-select.js';

function applyData(matches) {
  if (!matches.length) return;
  const changed = changedMatchIds(state.matches, matches);
  state.matches = matches;
  ...
  renderCategories();
  renderActiveView();
  refreshMatchDetail();
  pulseChanged(changed);
}

function pulseChanged(ids) {
  if (!ids.size) return;
  for (const id of ids) {
    document.querySelectorAll(`[data-match-id="${CSS.escape(String(id))}"]`).forEach((el) => {
      el.classList.add('scored');
      setTimeout(() => el.classList.remove('scored'), 1300);
    });
  }
}
```

Styles:

```css
.match.scored { animation: scorepulse 1.2s ease-out; }
@keyframes scorepulse {
  0% { border-color: var(--accent-2); box-shadow: 0 0 0 1px var(--accent-2); }
  100% { border-color: var(--line); box-shadow: none; }
}
@media (prefers-reduced-motion: reduce) { .match.scored { animation: none; } }
```

- [ ] **Step 3: Live dot on the tab**

`index.html`: `<button id="tabLive" ...>Live<span id="tabLiveDot" class="tab-live-dot" hidden></span></button>`

`app.js` `applyData()` (after `state.matches = matches`):

```js
$("tabLiveDot").hidden = !state.matches.some(isLive);
```

Styles:

```css
.tab-live-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--live); margin-left: 6px; vertical-align: middle;
  animation: pulse 2s infinite;
}
@media (prefers-reduced-motion: reduce) { .tab-live-dot { animation: none; } }
```

(`pulse` keyframes already exist for `.live-dot`.)

- [ ] **Step 4: Verify** — with the admin (or a second tab) scoring a
  live match: within 60 s the card pulses once, the Live tab dot shows
  while any match is live, the Matches tab shows the ● Live group on top.
  `prefers-reduced-motion` (devtools emulation) disables both animations.

- [ ] **Step 5: Commit**

```bash
git add js/views/matches-view.js app.js index.html styles.css
git commit -m "feat: live group, score pulse and live tab indicator"
```

---

### Task 6: Final verification

- [ ] **Step 1:** `npm run test:unit` — green (data-mapping, standings,
  state, live-select, ui, generators).
- [ ] **Step 2:** `sw.js` audit — new files present
  (`js/live-select.js`, `js/views/live-view.js`, `js/match-detail.js`),
  `VERSION` bumped for release.
- [ ] **Step 3:** Manual checklist (desktop + 390px + incognito):
  - fresh visitor lands on Live; returning visitor keeps their tab,
  - Live modes render + persist; pills hidden on Live only,
  - detail sheet from every card type; keyboard + ESC,
  - score pulse & tab dot fed by real admin scoring,
  - offline reload still works; no CSP violations.
- [ ] **Step 4: Commit stragglers**

```bash
git add -A
git commit -m "chore: final checks for viewer live features"
```
