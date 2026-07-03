# Teilprojekt 5: Standings/Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public viewer's Google Sheet data source with Supabase,
while leaving the standings/tiebreaker/bracket/rendering logic in `app.js`
untouched.

**Architecture:** A new pure module (`data-mapping.js`) maps raw Supabase
query results into the exact same object shapes `app.js` already consumes
(`rowToMatch()`'s match shape, `parseCautions()`'s caution shape, the rules
shape). A new thin `supabase-client.js` provides the Supabase client and
three query functions. `app.js`'s `load()`/`applyData()`/`cacheData()` are
rewritten to use these instead of CSV fetching/parsing; every other function
in `app.js` (standings computation, rendering, bracket, cards, PWA/service
worker) stays exactly as it is today.

**Tech Stack:** Supabase JS client via `esm.sh` CDN import (no bundler, no
build step — same pattern as `admin/supabase-client.js`), vanilla ES
modules, `node --test`.

## Global Constraints

- `app.js`'s standings/tiebreaker/bracket/rendering functions
  (`matchPointsFor`, `aggregate`, `criterionValues`, `breakTies`,
  `computeStandings`, `renderCategories`, `renderStandings`,
  `renderCrossTable`, `groupTeams`, `headToHead`, `knockoutMatches`,
  `knockoutStage`, `bracketNode`, `renderKnockout`, `renderMatchFilter`,
  `matchPassesFilter`, `renderMatches`, `matchCard`, `esc`, `setCategory`,
  `setView`, `renderActiveView`, `renderBracket`, `cautionBadge`,
  `renderCards`, the PWA-install and service-worker sections) — **must not
  change**. Only the data-fetching layer is replaced.
- Match objects fed into `state.matches` must have exactly the same shape
  `rowToMatch()` produces today: `{day, time, nr, court, teamA, teamB,
  round, category, bestOf, setsA, setsB, pointsA, pointsB, sets, status}`
  (`teamARaw`/`teamBRaw` are dropped — grep-confirmed unused anywhere
  outside `rowToMatch()` itself).
- `status` must be exactly one of the strings `"Not Started"`,
  `"In progress"`, `"Finished"` (matches `isFinished()`/`isLive()`/
  `statusClass()`/`matchPassesFilter()`'s exact string comparisons —
  `"Starting"` is never produced by the new mapping, which is fine since
  `isLive()` already treats `"In progress"` as live on its own).
- Unresolved KO slots (`team_a_id`/`team_b_id` is `null`, from Teilprojekt
  3) render as `"Sieger von <label>"` / `"Verlierer von <label>"` — and
  `isRealTeam()` must recognize exactly this prefix as "not a real team"
  (its current digit/`winner|loser`-regex heuristic matched the Sheet's
  English placeholder convention, which no longer exists).
- Cards data comes from `player_events` (Teilprojekt 2), not the Sheet's
  "Cautions" tab — aggregated into the exact same shape `parseCautions()`
  produced: `{team, teamName, category, nr, name, first, y, yr, r, events:
  [{game, type}]}`.
- `tournaments.config` is read at runtime (JSON, not CSV) with per-field
  fallback to `DEFAULT_RULES`/`DEFAULT_TIEBREAKERS` — matches today's
  "Config tab is optional" behavior, source only changes.
- Polling stays at `CONFIG.refreshMs` (60000ms) — no Supabase Realtime.
- One tournament — `tournaments` has exactly one row today; fetched via
  `.limit(1).single()`.
- The Google Sheet is fully retired for the public viewer — no fallback to
  it. `localStorage` caching stays as the offline fallback, now storing the
  already-mapped JSON instead of raw CSV text.
- No new database migration in this Teilprojekt — `tournaments.config`
  already exists (from Teilprojekt 1), unused until now.
- `index.html`'s `<script src="app.js">` becomes
  `<script type="module" src="app.js">` (required for ES module imports;
  confirmed no inline `onclick`/`onchange` HTML attributes exist that would
  break under module scoping).

## File Structure

- `data-mapping.js` (new, root) — pure functions, no DOM, no Supabase
  import: `DEFAULT_TIEBREAKERS`, `DEFAULT_RULES`, `statusLabel`,
  `sourceLabel`, `isRealTeam`, `mapMatch`, `mapCautions`,
  `rulesFromConfig`. Fully unit-testable with fixture inputs.
- `data-mapping.test.mjs` (new, root) — unit tests, run via
  `node --test data-mapping.test.mjs`.
- `supabase-client.js` (new, root) — `getClient()`, `fetchTournament()`,
  `fetchMatches(tournamentId)`, `fetchCautions(matchIds)`. Thin Supabase
  query wrappers, same pattern as `admin/db.js`; not independently unit
  tested (no logic beyond `.select()` chains — correctness is verified in
  Task 4's manual check against real data).
- `app.js` (modified) — data-fetching layer replaced (`load`, `applyData`,
  `cacheData`, boot-time cache read); dead CSV-era code removed
  (`parseCSV`, `rowToMatch`, `cleanTeam`, `num`, `parseRules`,
  `parseCautions`, `TIEBREAK_ALIASES`, `tbKey`, `CONFIG.sheetId`/`gid`,
  `DATA_URL`, `CONFIG_URL`, `CAUTIONS_URL`, `STATUS_VALUES`); `isRealTeam`
  replaced with an import from `data-mapping.js`; everything else
  untouched.
- `index.html` (modified) — one script tag attribute.
- `package.json` (modified) — `test:unit` gains `data-mapping.test.mjs`.

---

### Task 1: Pure data-mapping module

**Files:**
- Create: `data-mapping.js`
- Create: `data-mapping.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (pure functions, no imports).
- Produces: `DEFAULT_TIEBREAKERS: string[]`, `DEFAULT_RULES: {pointTable,
  drawPoints, tiebreakers}`, `statusLabel(status: 'scheduled'|'live'|
  'finished'): string`, `sourceLabel(sourceMatch: {sheet_match_nr, round_label}
  | null, outcome: 'winner'|'loser'): string`, `isRealTeam(name: string):
  boolean`, `mapMatch(row): matchObject`, `mapCautions(rows): cautionObject[]`,
  `rulesFromConfig(config: object | null): {pointTable, drawPoints,
  tiebreakers}` — Task 2's query functions and Task 3's `app.js` both
  import these.

- [ ] **Step 1: Write the failing tests**

Create `data-mapping.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIEBREAKERS, DEFAULT_RULES, statusLabel, sourceLabel, isRealTeam,
  mapMatch, mapCautions, rulesFromConfig,
} from './data-mapping.js';

test('statusLabel maps the 3 Supabase statuses to the 3 sheet-style display strings', () => {
  assert.equal(statusLabel('scheduled'), 'Not Started');
  assert.equal(statusLabel('live'), 'In progress');
  assert.equal(statusLabel('finished'), 'Finished');
});

test('sourceLabel returns a dash for a null source match', () => {
  assert.equal(sourceLabel(null, 'winner'), '—');
});

test('sourceLabel prefers sheet_match_nr over round_label, in German winner/loser phrasing', () => {
  assert.equal(sourceLabel({ sheet_match_nr: 52, round_label: 'Semi-final 1' }, 'winner'), 'Sieger von #52');
  assert.equal(sourceLabel({ sheet_match_nr: 52, round_label: 'Semi-final 1' }, 'loser'), 'Verlierer von #52');
});

test('sourceLabel falls back to round_label when sheet_match_nr is missing', () => {
  assert.equal(sourceLabel({ sheet_match_nr: null, round_label: 'Semi-final 1' }, 'winner'), 'Sieger von Semi-final 1');
});

test('isRealTeam recognizes the new German placeholder prefixes as not-real', () => {
  assert.equal(isRealTeam('Sieger von #52'), false);
  assert.equal(isRealTeam('Verlierer von Semi-final 1'), false);
  assert.equal(isRealTeam('Switzerland'), true);
  assert.equal(isRealTeam(''), false);
  assert.equal(isRealTeam(null), false);
});

test('mapMatch builds the standings-ready shape for a resolved, finished match with sets', () => {
  const row = {
    id: 'match-uuid-1', sheet_match_nr: 16, round_label: 'Qualification round',
    best_of: 5, status: 'finished', scheduled_time: '2026-07-23T10:30:00Z',
    team_a_id: 'team-a', team_b_id: 'team-b',
    team_a_source_outcome: null, team_b_source_outcome: null,
    team_a: { name: 'Chile' }, team_b: { name: 'India' },
    team_a_source_match: null, team_b_source_match: null,
    court: { name: '1' },
    categories: { name: 'U18 M Silver' },
    sets: [
      { set_number: 1, points_a: 11, points_b: 5, winner_team_id: 'team-a' },
      { set_number: 2, points_a: 9, points_b: 11, winner_team_id: 'team-b' },
      { set_number: 3, points_a: 11, points_b: 8, winner_team_id: 'team-a' },
    ],
  };
  const m = mapMatch(row);
  assert.equal(m.nr, 16);
  assert.equal(m.court, '1');
  assert.equal(m.teamA, 'Chile');
  assert.equal(m.teamB, 'India');
  assert.equal(m.round, 'Qualification round');
  assert.equal(m.category, 'U18 M Silver');
  assert.equal(m.bestOf, 5);
  assert.equal(m.setsA, 2);
  assert.equal(m.setsB, 1);
  assert.equal(m.pointsA, 31);
  assert.equal(m.pointsB, 24);
  assert.deepEqual(m.sets, [[11, 5], [9, 11], [11, 8]]);
  assert.equal(m.status, 'Finished');
});

test('mapMatch renders a "Sieger von" placeholder for an unresolved KO slot', () => {
  const row = {
    id: 'match-uuid-2', sheet_match_nr: 60, round_label: 'Final',
    best_of: 5, status: 'scheduled', scheduled_time: null,
    team_a_id: null, team_b_id: 'team-c',
    team_a_source_outcome: 'winner', team_b_source_outcome: null,
    team_a: null, team_b: { name: 'Kenya' },
    team_a_source_match: { sheet_match_nr: 52, round_label: 'Semi-final 1' },
    team_b_source_match: null,
    court: null,
    categories: { name: 'U18 Men' },
    sets: [],
  };
  const m = mapMatch(row);
  assert.equal(m.teamA, 'Sieger von #52');
  assert.equal(m.teamB, 'Kenya');
  assert.equal(m.setsA, 0);
  assert.equal(m.setsB, 0);
  assert.equal(m.pointsA, 0);
  assert.equal(m.pointsB, 0);
  assert.deepEqual(m.sets, []);
  assert.equal(m.status, 'Not Started');
  assert.equal(m.day, '');
  assert.equal(m.time, '');
});

test('mapMatch falls back to a shortened id when sheet_match_nr is missing', () => {
  const row = {
    id: 'aabbccdd-1234-5678-9999-000000000000', sheet_match_nr: null, round_label: 'Group Match 1',
    best_of: 3, status: 'scheduled', scheduled_time: null,
    team_a_id: 'team-a', team_b_id: 'team-b',
    team_a_source_outcome: null, team_b_source_outcome: null,
    team_a: { name: 'Switzerland' }, team_b: { name: 'Austria' },
    team_a_source_match: null, team_b_source_match: null,
    court: null, categories: { name: 'Test Category' }, sets: [],
  };
  const m = mapMatch(row);
  assert.equal(m.nr, 'aabbccdd');
});

test('mapCautions aggregates multiple events for the same player and keeps players separate', () => {
  const rows = [
    {
      event_type: 'Y', player_id: 'p1',
      player: { family_name: 'Muster', given_name: 'Max', jersey_number: 7, team: { name: 'Switzerland', category: { name: 'U18 M Gold' } } },
      match: { round_label: 'Qualification round' },
    },
    {
      event_type: 'YR', player_id: 'p1',
      player: { family_name: 'Muster', given_name: 'Max', jersey_number: 7, team: { name: 'Switzerland', category: { name: 'U18 M Gold' } } },
      match: { round_label: 'Semi-final 1' },
    },
    {
      event_type: 'R', player_id: 'p2',
      player: { family_name: 'Anders', given_name: 'Anna', jersey_number: 3, team: { name: 'Austria', category: { name: 'U18 W Gold' } } },
      match: { round_label: null },
    },
  ];
  const result = mapCautions(rows);
  assert.equal(result.length, 2);
  const p1 = result.find((p) => p.name === 'Muster');
  assert.equal(p1.teamName, 'Switzerland');
  assert.equal(p1.category, 'U18 M Gold');
  assert.equal(p1.nr, 7);
  assert.equal(p1.first, 'Max');
  assert.equal(p1.y, 1);
  assert.equal(p1.yr, 1);
  assert.equal(p1.r, 0);
  assert.equal(p1.events.length, 2);
  const p2 = result.find((p) => p.name === 'Anders');
  assert.equal(p2.r, 1);
  assert.equal(p2.events[0].game, '');
});

test('rulesFromConfig returns full defaults for null or empty config', () => {
  assert.deepEqual(rulesFromConfig(null), DEFAULT_RULES);
  assert.deepEqual(rulesFromConfig({}), DEFAULT_RULES);
});

test('rulesFromConfig applies config fields individually, falling back per-field', () => {
  const result = rulesFromConfig({ drawPoints: 2 });
  assert.equal(result.drawPoints, 2);
  assert.deepEqual(result.pointTable, DEFAULT_RULES.pointTable);
  assert.deepEqual(result.tiebreakers, DEFAULT_TIEBREAKERS);
});

test('rulesFromConfig normalizes tiebreaker aliases the same way the old Config-tab parser did', () => {
  const result = rulesFromConfig({ tiebreakers: ['SET_DIFFERENCE', 'H2H_POINT_QUOTIENT', 'not_a_real_key'] });
  assert.deepEqual(result.tiebreakers, ['SET_DIFF', 'H2H_POINT_RATIO']);
});

test('rulesFromConfig keeps a provided point table as-is', () => {
  const pointTable = [{ bestOf: 5, winSets: 3, loseSets: 0, winPts: 3, losePts: 0 }];
  const result = rulesFromConfig({ pointTable });
  assert.deepEqual(result.pointTable, pointTable);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test data-mapping.test.mjs`
Expected: FAIL — `data-mapping.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `data-mapping.js`:

```js
export const DEFAULT_TIEBREAKERS = [
  'H2H_SET_DIFF', 'H2H_SET_RATIO', 'H2H_POINT_DIFF',
  'SET_DIFF', 'SET_RATIO', 'POINT_DIFF',
];
export const DEFAULT_RULES = { pointTable: [], drawPoints: 1, tiebreakers: DEFAULT_TIEBREAKERS.slice() };

export function statusLabel(status) {
  if (status === 'live') return 'In progress';
  if (status === 'finished') return 'Finished';
  return 'Not Started';
}

export function sourceLabel(sourceMatch, outcome) {
  if (!sourceMatch) return '—';
  const label = sourceMatch.sheet_match_nr ? `#${sourceMatch.sheet_match_nr}` : (sourceMatch.round_label || 'Match');
  return outcome === 'winner' ? `Sieger von ${label}` : `Verlierer von ${label}`;
}

// A team is a real entrant, not a bracket placeholder. Placeholders are the
// "Sieger von .../Verlierer von ..." strings sourceLabel() produces above —
// real team/country names never start with either phrase.
export function isRealTeam(name) {
  if (!name) return false;
  return !/^(Sieger von|Verlierer von)\s/.test(name);
}

export function mapMatch(row) {
  const sets = (row.sets || []).slice().sort((a, b) => a.set_number - b.set_number);
  let setsA = 0, setsB = 0, pointsA = 0, pointsB = 0;
  const setPairs = [];
  for (const s of sets) {
    pointsA += s.points_a;
    pointsB += s.points_b;
    if (s.winner_team_id === row.team_a_id) setsA++;
    else if (s.winner_team_id === row.team_b_id) setsB++;
    setPairs.push([s.points_a, s.points_b]);
  }

  let day = '', time = '';
  if (row.scheduled_time) {
    const dt = new Date(row.scheduled_time);
    day = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return {
    day, time,
    nr: row.sheet_match_nr || row.id.slice(0, 8),
    court: row.court?.name || '',
    teamA: row.team_a ? row.team_a.name : sourceLabel(row.team_a_source_match, row.team_a_source_outcome),
    teamB: row.team_b ? row.team_b.name : sourceLabel(row.team_b_source_match, row.team_b_source_outcome),
    round: row.round_label || '',
    category: row.categories?.name || '',
    bestOf: row.best_of,
    setsA, setsB,
    pointsA, pointsB,
    sets: setPairs,
    status: statusLabel(row.status),
  };
}

export function mapCautions(rows) {
  const players = new Map();
  for (const r of rows) {
    if (!players.has(r.player_id)) {
      players.set(r.player_id, {
        team: r.player.team.name,
        teamName: r.player.team.name,
        category: r.player.team.category.name,
        nr: r.player.jersey_number ?? '',
        name: r.player.family_name,
        first: r.player.given_name,
        y: 0, yr: 0, r: 0, events: [],
      });
    }
    const p = players.get(r.player_id);
    const key = r.event_type === 'Y' ? 'y' : r.event_type === 'YR' ? 'yr' : 'r';
    p[key]++;
    p.events.push({ game: r.match?.round_label || '', type: r.event_type });
  }
  return [...players.values()];
}

const TIEBREAK_ALIASES = {
  H2H_SET_DIFF: 'H2H_SET_DIFF', H2H_SET_DIFFERENCE: 'H2H_SET_DIFF',
  H2H_SET_RATIO: 'H2H_SET_RATIO', H2H_SET_QUOTIENT: 'H2H_SET_RATIO',
  H2H_POINT_DIFF: 'H2H_POINT_DIFF', H2H_POINT_DIFFERENCE: 'H2H_POINT_DIFF',
  H2H_POINT_RATIO: 'H2H_POINT_RATIO', H2H_POINT_QUOTIENT: 'H2H_POINT_RATIO',
  SET_DIFF: 'SET_DIFF', SET_DIFFERENCE: 'SET_DIFF',
  SET_RATIO: 'SET_RATIO', SET_QUOTIENT: 'SET_RATIO',
  POINT_DIFF: 'POINT_DIFF', POINT_DIFFERENCE: 'POINT_DIFF',
  POINT_RATIO: 'POINT_RATIO', POINT_QUOTIENT: 'POINT_RATIO',
  WINS: 'WINS',
};
const tbKey = (raw) => TIEBREAK_ALIASES[String(raw).trim().toUpperCase().replace(/[\s.\-]+/g, '_')] || null;

export function rulesFromConfig(config) {
  const out = {
    pointTable: DEFAULT_RULES.pointTable,
    drawPoints: DEFAULT_RULES.drawPoints,
    tiebreakers: DEFAULT_TIEBREAKERS.slice(),
  };
  if (!config) return out;
  if (Array.isArray(config.pointTable) && config.pointTable.length) out.pointTable = config.pointTable;
  if (typeof config.drawPoints === 'number') out.drawPoints = config.drawPoints;
  if (Array.isArray(config.tiebreakers) && config.tiebreakers.length) {
    const list = config.tiebreakers.map(tbKey).filter(Boolean);
    if (list.length) out.tiebreakers = list;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test data-mapping.test.mjs`
Expected: `# pass 13`.

- [ ] **Step 5: Wire into `test:unit`**

In `package.json`, change:

```json
"test:unit": "node --test scripts/__tests__/*.test.mjs admin/schedule-generator.test.mjs admin/referee-assignment-generator.test.mjs",
```

to:

```json
"test:unit": "node --test scripts/__tests__/*.test.mjs admin/schedule-generator.test.mjs admin/referee-assignment-generator.test.mjs data-mapping.test.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add data-mapping.js data-mapping.test.mjs package.json
git commit -m "feat: add pure Supabase-to-viewer data mapping functions"
```

---

### Task 2: Supabase client and query functions

**Files:**
- Create: `supabase-client.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of `data-mapping.js` —
  it returns raw Supabase rows, `data-mapping.js`'s functions transform
  them; the two files are combined only in `app.js`, Task 3).
- Produces: `getClient()`, `fetchTournament(): Promise<{id, name, config}>`,
  `fetchMatches(tournamentId): Promise<Array<rawMatchRow>>` (the exact
  shape `mapMatch()` expects — see Task 1), `fetchCautions(matchIds:
  string[]): Promise<Array<rawCautionRow>>` (the exact shape
  `mapCautions()` expects) — Task 3's `app.js` imports all three query
  functions plus `getClient` is not used directly outside this file.

- [ ] **Step 1: Create the client and query functions**

Create `supabase-client.js`:

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Public, read-only anon key — safe to commit, same as admin/config.js's
// production values. No login, no session: the public viewer only ever
// reads data that every RLS policy already exposes to anon.
const SUPABASE_URL = 'https://obujvbiwqspdnewetgyi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9idWp2Yml3cXNwZG5ld2V0Z3lpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDE2NzEsImV4cCI6MjA5ODUxNzY3MX0.GX4iOpfx9fdc-YPJx7QrgKPzOvNzxdy0MOWdbKh8tfk';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getClient() {
  return client;
}

export async function fetchTournament() {
  const { data, error } = await client.from('tournaments').select('id, name, config').limit(1).single();
  if (error) throw error;
  return data;
}

export async function fetchMatches(tournamentId) {
  const { data, error } = await client
    .from('matches')
    .select(`
      id, sheet_match_nr, round_label, best_of, status, scheduled_time,
      team_a_id, team_b_id, team_a_source_outcome, team_b_source_outcome,
      team_a:team_a_id(name), team_b:team_b_id(name),
      team_a_source_match:team_a_source_match_id(sheet_match_nr, round_label),
      team_b_source_match:team_b_source_match_id(sheet_match_nr, round_label),
      court:court_id(name),
      categories!inner(name, tournament_id),
      sets(set_number, points_a, points_b, winner_team_id)
    `)
    .eq('categories.tournament_id', tournamentId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}

export async function fetchCautions(matchIds) {
  if (matchIds.length === 0) return [];
  const { data, error } = await client
    .from('player_events')
    .select(`
      event_type, player_id,
      player:player_id(family_name, given_name, jersey_number, team:team_id(name, category:category_id(name))),
      match:match_id(round_label)
    `)
    .in('match_id', matchIds);
  if (error) throw error;
  return data;
}
```

The anon key above is the exact same value already committed in
`admin/config.js` — confirm it matches before committing (it must be a
literal copy, not retyped, to avoid a transcription error):

Run: `grep -o '"eyJ[^"]*"' admin/config.js`
Expected: the second match (the `SUPABASE_ANON_KEY` value) is byte-identical
to the string used above.

- [ ] **Step 2: Commit**

```bash
git add supabase-client.js
git commit -m "feat: add public-viewer Supabase client and query functions"
```

---

### Task 3: Wire the new data layer into `app.js`

**Files:**
- Modify: `app.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: everything from Task 1 (`data-mapping.js`) and Task 2
  (`supabase-client.js`).
- Produces: nothing new — this task's only job is to make `app.js` use the
  new data layer while leaving every other function's behavior identical.

**Before you touch anything: read the current `app.js` in full.** It is
1028 lines and this task edits maybe 150 of them — the rest (all standings
computation, all rendering, the PWA/service-worker code) must not change
at all. Do not "clean up" or "improve" anything you're not explicitly
instructed to touch in this task — a working standings computation for a
real upcoming tournament is the single highest-risk thing in this whole
Teilprojekt.

- [ ] **Step 1: Update `index.html`**

Change:

```html
  <script src="app.js"></script>
```

to:

```html
  <script type="module" src="app.js"></script>
```

- [ ] **Step 2: Replace the top-of-file constants block in `app.js`**

Replace this entire block (currently lines 7–33 — find it by its opening
comment `/* ====... Fistball Live ... ====*/` and the `const rules = ...`
line that ends it):

```js
const CONFIG = {
  // The published/shared Google Sheet that holds the results.
  sheetId: "1IWuv2zOZtIJDZCFnItp_z8p546azRGlD8I052jVe8Mk",
  gid: "0",                 // tab that holds the schedule + scores
  refreshMs: 60000,         // auto-refresh interval
};

// gviz CSV endpoint — works for any sheet shared as "anyone with the link can view".
const DATA_URL = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}&_=`;
// The Config tab is read by NAME, so the same app works for any event's sheet.
const CONFIG_URL = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&sheet=Config&_=`;
// Disciplinary records (yellow / yellow-red / red cards) per player.
const CAUTIONS_URL = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&sheet=Cautions&_=`;

// Rounds that form a round-robin group stage (used to compute standings).
const GROUP_ROUNDS = ["Qualification round", "WEC - Vorrunde"];
const STATUS_VALUES = ["Not Started", "Starting", "In progress", "Finished"];

// Scoring & tie-break rules — defaults follow the official IFA rule (art. 11):
// win 2 / draw 1 / loss 0, then head-to-head set diff/quotient/point diff,
// then the same across all group matches. Overridden by the sheet's Config tab.
const DEFAULT_TIEBREAKERS = [
  "H2H_SET_DIFF", "H2H_SET_RATIO", "H2H_POINT_DIFF",
  "SET_DIFF", "SET_RATIO", "POINT_DIFF",
];
const DEFAULT_RULES = { pointTable: [], drawPoints: 1, tiebreakers: DEFAULT_TIEBREAKERS.slice() };
const rules = () => state.rules || DEFAULT_RULES;
```

with:

```js
import { fetchTournament, fetchMatches, fetchCautions } from './supabase-client.js';
import {
  DEFAULT_TIEBREAKERS, DEFAULT_RULES, sourceLabel, isRealTeam as isRealTeamName,
  mapMatch, mapCautions, rulesFromConfig,
} from './data-mapping.js';

const CONFIG = {
  refreshMs: 60000,         // auto-refresh interval
};

// Rounds that form a round-robin group stage (used to compute standings).
const GROUP_ROUNDS = ["Qualification round", "WEC - Vorrunde"];

const rules = () => state.rules || DEFAULT_RULES;
```

(`isRealTeamName` is a temporary import alias — Step 4 below removes the
old local `isRealTeam` definition and Step 5 renames every call site back
to `isRealTeam` via a thin local wrapper, so the rest of the file's calls
don't need to change at all. This keeps this step's diff minimal and
mechanical.)

- [ ] **Step 3: Remove the CSV-parsing section**

Delete this entire block in full (currently under the `/* ---------------------- CSV parsing ---------------------- */` comment):

```js
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
```

Delete the comment header `/* ---------------------- CSV parsing ---------------------- */` along with it.

- [ ] **Step 4: Replace the "Match model" section**

Replace this entire block (under `/* ---------------------- Match model ---------------------- */`):

```js
const num = (v) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

// Strip the trailing " - <Category>" suffix from a team name.
function cleanTeam(name, category) {
  if (!name) return name;
  let n = name.trim();
  if (category && n.endsWith(" - " + category)) {
    n = n.slice(0, -(" - " + category).length);
  } else {
    // fall back: drop suffix after last " - " if it looks like a category tag
    const m = n.match(/^(.*?) - (U18 .*|WEC)$/);
    if (m) n = m[1];
  }
  return n.trim();
}

// A team is a real entrant (not a bracket placeholder).
// Placeholders are the *cleaned* names like "Gold 3rd", "Winner SF1", "WEC R4",
// "5th Silver", "Loser L1" — all of which contain a digit or "winner"/"loser".
// Real country names never do.
function isRealTeam(name) {
  if (!name) return false;
  return !/\d/.test(name) && !/(winner|loser)/i.test(name);
}

function flagFor(team) {
  return FLAGS[team] || "";
}

// Build a match object from one CSV data row.
function rowToMatch(r) {
  const nr = num(r[2]);
  const teamA = (r[4] || "").trim();
  const teamB = (r[5] || "").trim();
  const category = (r[7] || "").trim();
  if (!nr || !teamA || !teamB || !category) return null;

  const setsA = num(r[9]);
  const setsB = num(r[11]);

  // Status: find a cell matching a known status value.
  let status = "Not Started";
  for (const cell of r) {
    const t = (cell || "").trim();
    if (STATUS_VALUES.includes(t)) { status = t; break; }
  }

  // Total points: located around the "|" separator token.
  let pointsA = 0, pointsB = 0;
  const pipeIdx = r.findIndex((c) => (c || "").trim() === "|");
  if (pipeIdx > 0) { pointsA = num(r[pipeIdx - 1]); pointsB = num(r[pipeIdx + 1]); }

  // Per-set scores: triplets (a, "x", b) sitting between Total Sets (col 11) and the "|".
  const sets = [];
  const setEnd = pipeIdx > 13 ? pipeIdx : r.length;
  for (let i = 12; i + 2 < setEnd; i += 3) {
    if ((r[i + 1] || "").trim() !== "x") break;
    const a = num(r[i]), b = num(r[i + 2]);
    if (a === 0 && b === 0) continue;
    sets.push([a, b]);
  }

  return {
    day: (r[0] || "").trim(),
    time: (r[1] || "").trim(),
    nr,
    court: (r[3] || "").trim(),
    teamARaw: teamA,
    teamBRaw: teamB,
    teamA: cleanTeam(teamA, category),
    teamB: cleanTeam(teamB, category),
    round: (r[6] || "").trim(),
    category,
    bestOf: num(r[8]),
    setsA, setsB,
    pointsA, pointsB,
    sets,
    status,
  };
}
```

with:

```js
function isRealTeam(name) {
  return isRealTeamName(name);
}

function flagFor(team) {
  return FLAGS[team] || "";
}
```

(The rest of this file's many call sites — `computeStandings`,
`groupTeams`, etc. — call `isRealTeam(...)`, not `isRealTeamName(...)`.
This thin wrapper means Step 2's import rename doesn't ripple through the
rest of the file. `flagFor` is untouched, just kept in place since it sat
in the same section.)

- [ ] **Step 5: Replace the Config/rules section**

Delete this entire block in full (under `/* ---------------------- Rules from the Config tab ---------------------- */`):

```js
const TIEBREAK_ALIASES = {
  H2H_SET_DIFF: "H2H_SET_DIFF", H2H_SET_DIFFERENCE: "H2H_SET_DIFF",
  H2H_SET_RATIO: "H2H_SET_RATIO", H2H_SET_QUOTIENT: "H2H_SET_RATIO",
  H2H_POINT_DIFF: "H2H_POINT_DIFF", H2H_POINT_DIFFERENCE: "H2H_POINT_DIFF",
  H2H_POINT_RATIO: "H2H_POINT_RATIO", H2H_POINT_QUOTIENT: "H2H_POINT_RATIO",
  SET_DIFF: "SET_DIFF", SET_DIFFERENCE: "SET_DIFF",
  SET_RATIO: "SET_RATIO", SET_QUOTIENT: "SET_RATIO",
  POINT_DIFF: "POINT_DIFF", POINT_DIFFERENCE: "POINT_DIFF",
  POINT_RATIO: "POINT_RATIO", POINT_QUOTIENT: "POINT_RATIO",
  WINS: "WINS",
};
const tbKey = (raw) => TIEBREAK_ALIASES[String(raw).trim().toUpperCase().replace(/[\s.\-]+/g, "_")] || null;

// Parse the Config tab by scanning for labels (robust to layout changes).
function parseRules(csvText) {
  const out = { pointTable: [], drawPoints: 1, tiebreakers: DEFAULT_TIEBREAKERS.slice() };
  let rows;
  try { rows = parseCSV(csvText); } catch (_) { return out; }
  const up = (s) => String(s || "").trim().toUpperCase().replace(/[\s.]+/g, "_");

  // Point Table — find the BEST_OF header, read columns by name, rows until non-numeric.
  for (let r = 0; r < rows.length; r++) {
    const hdr = rows[r];
    if (hdr.findIndex((c) => up(c) === "BEST_OF") === -1) continue;
    const col = (...names) => hdr.findIndex((c) => names.includes(up(c)));
    const cB = col("BEST_OF");
    const cSV = col("SETS_VENCEDOR", "WINNER_SETS", "SETS_VENC");
    const cSP = col("SETS_PERDEDOR", "LOSER_SETS", "SETS_PERD");
    const cPV = col("PTS_VENCEDOR", "WINNER_PTS", "PTS_VENC", "POINTS_WINNER");
    const cPP = col("PTS_PERDEDOR", "LOSER_PTS", "PTS_PERD", "POINTS_LOSER");
    if (cSV < 0 || cSP < 0 || cPV < 0 || cPP < 0) break;
    for (let k = r + 1; k < rows.length; k++) {
      const bo = parseInt(String(rows[k][cB]).trim(), 10);
      if (!Number.isFinite(bo)) break;
      out.pointTable.push({
        bestOf: bo, winSets: num(rows[k][cSV]), loseSets: num(rows[k][cSP]),
        winPts: num(rows[k][cPV]), losePts: num(rows[k][cPP]),
      });
    }
    break;
  }

  // DRAW_POINTS — labelled cell, value to its right.
  for (let r = 0; r < rows.length && out.drawPoints === 1; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (["DRAW_POINTS", "DRAW", "EMPATE", "PONTOS_EMPATE"].includes(up(rows[r][c]))) {
        for (let c2 = c + 1; c2 < rows[r].length; c2++) {
          const v = String(rows[r][c2]).trim();
          if (v !== "") { const n = parseFloat(v); if (Number.isFinite(n)) out.drawPoints = n; break; }
        }
      }
    }
  }

  // TIEBREAKERS — labelled cell, ordered list read downward in the same column.
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].findIndex((x) => ["TIEBREAKERS", "TIEBREAKER", "DESEMPATE", "DESEMPATES"].includes(up(x)));
    if (c === -1) continue;
    const list = [];
    for (let k = r + 1; k < rows.length; k++) {
      const raw = String(rows[k][c]).trim();
      if (raw === "") break;
      const key = tbKey(raw);
      if (key) list.push(key);
    }
    if (list.length) out.tiebreakers = list;
    break;
  }
  return out;
}
```

Do not add a replacement — `rulesFromConfig` (imported in Step 2) covers
this entirely; it's called directly from `load()` in Step 7.

- [ ] **Step 6: Replace `parseCautions` with nothing (delete only)**

Delete this function in full (under `/* ---------------------- Cards (cautions) ---------------------- */`, keep `cautionBadge` and `renderCards` which sit in the same section untouched):

```js
// Parse the Cautions tab. Primary source = the raw event list (one row per
// caution, with the game and type); falls back to the aggregated summary.
function parseCautions(csvText) {
  let rows;
  try { rows = parseCSV(csvText); } catch (_) { return []; }
  const players = new Map();
  const ensure = (team, nr, name, first) => {
    const key = `${team}|${nr}|${name}|${first}`;
    if (!players.has(key)) {
      const i = team.indexOf(" - ");
      players.set(key, {
        team, teamName: i >= 0 ? team.slice(0, i) : team,
        category: i >= 0 ? team.slice(i + 3) : "",
        nr, name, first, y: 0, yr: 0, r: 0, events: [],
      });
    }
    return players.get(key);
  };
  const TYPES = ["Y", "YR", "R"];
  // Raw events: cols K–P → Team(10), Nr(11), Name(12), First(13), Game(14), Caution(15)
  for (const r of rows) {
    const team = (r[10] || "").trim();
    const c = (r[15] || "").trim().toUpperCase();
    if (!team || !TYPES.includes(c)) continue;
    const p = ensure(team, (r[11] || "").trim(), (r[12] || "").trim(), (r[13] || "").trim());
    p[c.toLowerCase()]++;
    p.events.push({ game: (r[14] || "").trim(), type: c });
  }
  // Fallback: aggregated summary cols A–I (Team1, Nr2, Name3, First4, Y5, YR6, R7)
  if (players.size === 0) {
    for (const r of rows) {
      const team = (r[1] || "").trim();
      if (!team || team === "#N/A") continue;
      const y = num(r[5]), yr = num(r[6]), rr = num(r[7]);
      if (y + yr + rr === 0) continue;
      const p = ensure(team, (r[2] || "").trim(), (r[3] || "").trim(), (r[4] || "").trim());
      p.y = y; p.yr = yr; p.r = rr;
    }
  }
  return [...players.values()];
}
```

- [ ] **Step 7: Replace the data-loading section**

Replace this entire block (under `/* ---------------------- Data loading ---------------------- */`):

```js
async function load(showSpin) {
  const btn = $("refreshBtn");
  if (showSpin) btn.classList.add("spin");
  try {
    const [resR, cfgR, cauR] = await Promise.allSettled([
      fetch(DATA_URL + Date.now(), { cache: "no-store" }),
      fetch(CONFIG_URL + Date.now(), { cache: "no-store" }),
      fetch(CAUTIONS_URL + Date.now(), { cache: "no-store" }),
    ]);
    // Config is optional — fall back to defaults / cache if it fails.
    if (cfgR.status === "fulfilled" && cfgR.value.ok) {
      const cfgText = await cfgR.value.text();
      state.rules = parseRules(cfgText);
      try { localStorage.setItem("fb_rules", cfgText); } catch (_) {}
    } else if (!state.rules) {
      const cachedCfg = localStorage.getItem("fb_rules");
      state.rules = cachedCfg ? parseRules(cachedCfg) : DEFAULT_RULES;
    }
    // Cautions are optional too.
    if (cauR.status === "fulfilled" && cauR.value.ok) {
      const cauText = await cauR.value.text();
      state.cautions = parseCautions(cauText);
      try { localStorage.setItem("fb_cautions", cauText); } catch (_) {}
    } else if (!state.cautions.length) {
      const cachedCau = localStorage.getItem("fb_cautions");
      if (cachedCau) state.cautions = parseCautions(cachedCau);
    }
    if (resR.status !== "fulfilled" || !resR.value.ok) throw new Error("results fetch failed");
    const text = await resR.value.text();
    applyData(text);
    cacheData(text);
    $("banner").hidden = true;
  } catch (err) {
    console.warn("Live fetch failed:", err);
    if (!state.rules) state.rules = DEFAULT_RULES;
    const cached = localStorage.getItem("fb_cache");
    if (cached && !state.matches.length) applyData(cached);
    showBanner("Couldn't reach the live sheet — showing the last data loaded. Pull to refresh when back online.");
  } finally {
    btn.classList.remove("spin");
  }
}

function applyData(csvText) {
  const rows = parseCSV(csvText);
  const matches = rows.map(rowToMatch).filter(Boolean);
  if (!matches.length) return;
  state.matches = matches;

  // Distinct categories in sheet order.
  const seen = new Set();
  const cats = [];
  for (const m of matches) if (!seen.has(m.category)) { seen.add(m.category); cats.push(m.category); }
  // Order by the defined category order, unknowns last (alphabetical).
  cats.sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
  state.categories = cats;

  if (!state.activeCategory || !cats.includes(state.activeCategory)) {
    state.activeCategory = cats[0];
    localStorage.setItem("fb_category", state.activeCategory);
  }

  state.lastUpdated = new Date();
  $("updated").textContent = "Updated " + state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("loading").hidden = true;

  renderCategories();
  renderActiveView();
}

function cacheData(text) {
  try { localStorage.setItem("fb_cache", text); } catch (_) {}
}
```

with:

```js
async function load(showSpin) {
  const btn = $("refreshBtn");
  if (showSpin) btn.classList.add("spin");
  try {
    const tournament = await fetchTournament();
    const rawMatches = await fetchMatches(tournament.id);
    const matches = rawMatches.map(mapMatch);
    const matchIds = rawMatches.map((m) => m.id);

    state.rules = rulesFromConfig(tournament.config);
    try { localStorage.setItem("fb_rules", JSON.stringify(state.rules)); } catch (_) {}

    // Cautions are optional — a failure here must not block the main
    // standings/matches display.
    const [cauR] = await Promise.allSettled([fetchCautions(matchIds)]);
    if (cauR.status === "fulfilled") {
      state.cautions = mapCautions(cauR.value);
      try { localStorage.setItem("fb_cautions", JSON.stringify(state.cautions)); } catch (_) {}
    } else if (!state.cautions.length) {
      const cachedCau = localStorage.getItem("fb_cautions");
      if (cachedCau) state.cautions = JSON.parse(cachedCau);
    }

    applyData(matches);
    cacheData(matches);
    $("banner").hidden = true;
  } catch (err) {
    console.warn("Live fetch failed:", err);
    if (!state.rules) {
      const cachedRules = localStorage.getItem("fb_rules");
      state.rules = cachedRules ? JSON.parse(cachedRules) : DEFAULT_RULES;
    }
    const cached = localStorage.getItem("fb_cache");
    if (cached && !state.matches.length) applyData(JSON.parse(cached));
    showBanner("Couldn't reach the live data — showing the last data loaded. Pull to refresh when back online.");
  } finally {
    btn.classList.remove("spin");
  }
}

function applyData(matches) {
  if (!matches.length) return;
  state.matches = matches;

  // Distinct categories in fetch order (already sorted by scheduled_time).
  const seen = new Set();
  const cats = [];
  for (const m of matches) if (!seen.has(m.category)) { seen.add(m.category); cats.push(m.category); }
  // Order by the defined category order, unknowns last (alphabetical).
  cats.sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
  state.categories = cats;

  if (!state.activeCategory || !cats.includes(state.activeCategory)) {
    state.activeCategory = cats[0];
    localStorage.setItem("fb_category", state.activeCategory);
  }

  state.lastUpdated = new Date();
  $("updated").textContent = "Updated " + state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("loading").hidden = true;

  renderCategories();
  renderActiveView();
}

function cacheData(matches) {
  try { localStorage.setItem("fb_cache", JSON.stringify(matches)); } catch (_) {}
}
```

- [ ] **Step 8: Update the boot-time cache read**

Find this block at the very end of the file (under `/* ---------------------- Boot ---------------------- */`):

```js
// initial cache paint for instant load, then network
const boot = localStorage.getItem("fb_cache");
if (boot) try { applyData(boot); } catch (_) {}
load(true);
```

Replace it with:

```js
// initial cache paint for instant load, then network
const boot = localStorage.getItem("fb_cache");
if (boot) try { applyData(JSON.parse(boot)); } catch (_) {}
load(true);
```

(Only the `applyData(boot)` call changes, to `applyData(JSON.parse(boot))`
— everything else in the Boot section, including the `setInterval`/
`visibilitychange` polling wiring and the tab-click handlers, is
unchanged.)

- [ ] **Step 9: Verify nothing else changed**

Run: `git diff --stat app.js`
Expected: a moderate-size diff (roughly 150–250 lines changed) concentrated
in the sections named in Steps 2–8. Run `git diff app.js` and read it in
full — every hunk should correspond to one of the 8 steps above. If you see
a hunk touching `computeStandings`, `renderStandings`, `renderKnockout`,
`bracketNode`, `renderMatches`, `matchCard`, `renderCards`, the PWA-install
block, or the service-worker block, that is a mistake — revert it.

- [ ] **Step 10: Commit**

```bash
git add app.js index.html
git commit -m "feat: replace public viewer's Google Sheet data source with Supabase"
```

---

### Task 4: Full test run and manual verification

**Files:** none (verification task).

- [ ] **Step 1: Run the unit tests**

```bash
node --test data-mapping.test.mjs
```

Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 2: Run the full existing suite to confirm no regressions**

```bash
npx supabase db reset
set -a && source .env && set +a
node scripts/seed-roles.mjs
node scripts/generate-admin-config.mjs
npm run test
```

Expected: all of `test:unit`, `test:rls`, `test:e2e` still pass — this
Teilprojekt touches no admin-app code, so this is a pure regression check.
Then restore `admin/config.js`: `git checkout -- admin/config.js`.

- [ ] **Step 3: Seed a realistic local fixture via the admin app**

Serve the admin app locally (`npx http-server admin -p 5050 -c-1` in one
terminal) and, using the seeded local admin login
(`admin@fistball-ems.local` / the `SEED_ADMIN_PASSWORD` value from `.env`),
create through the actual UI:
- A tournament with a `config` value set directly via SQL (optional — the
  default-empty-config path is already covered by Task 1's unit tests; if
  you want to exercise the non-default path too, run
  `npx supabase db execute --local "update tournaments set config = '{\"drawPoints\": 2}'::jsonb"`
  after creating the tournament).
- A category, at least 3 teams, and a round-robin group of matches (use
  the Spielplan-Generator screen from Teilprojekt 3 for this).
- At least one finished match with recorded sets (use the Game Report
  screen from Teilprojekt 2 — start the match, record points until a set
  and the match finish).
- At least one KO match wired to a "Sieger von"/source-based team slot
  (use the Matches screen's Team-A-Modus/Team-B-Modus selects from
  Teilprojekt 3).
- At least one card (Y/YR/R) recorded via the Game Report screen's card
  form.

- [ ] **Step 4: Point the public viewer at the local stack and verify with a throwaway script**

`supabase-client.js` currently hardcodes the production URL/anon key (Task
2). For this local check only, temporarily edit the two constants at the
top of `supabase-client.js` to the local values from `.env`
(`SUPABASE_URL`/`SUPABASE_ANON_KEY`) — **do not commit this change**, it
gets reverted in Step 5.

Serve the root site locally in a second terminal:
`npx http-server . -p 5051 -c-1`

Write a throwaway Playwright script (not a committed test file — this
project's public viewer has no permanent E2E test suite, per the approved
spec) to drive a real browser against it. Save it as
`/tmp/claude-scratch-verify-viewer.mjs` (outside the repo, so there's no
risk of accidentally committing it) with this content, adjusted to match
the exact category/team names you used in Step 3:

```js
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5051');
await page.waitForSelector('#categoryPills button', { timeout: 15000 });

// Standings tab (default view): the category you created should be
// selectable and the finished match's teams should appear in the table.
const categoryButtons = await page.locator('#categoryPills button').allTextContents();
console.log('Categories found:', categoryButtons);

await page.click('#tabMatches');
await page.waitForSelector('.match', { timeout: 10000 });
const matchCount = await page.locator('.match').count();
console.log('Match cards rendered:', matchCount);
const bodyText = await page.locator('#matches').innerText();
console.log('Contains a real team name:', /./.test(bodyText)); // manual check below

await page.click('#tabBracket');
await page.waitForTimeout(500);
const bracketText = await page.locator('#bracket').innerText();
console.log('Bracket view text:', bracketText.slice(0, 500));

await page.click('#tabCards');
await page.waitForTimeout(500);
const cardsText = await page.locator('#cards').innerText();
console.log('Cards view text:', cardsText.slice(0, 500));

await browser.close();
```

Run: `node /tmp/claude-scratch-verify-viewer.mjs`

Manually inspect the printed output:
- The categories list should contain the category you created in Step 3.
- The match count should match the number of matches you created.
- The bracket view text should show your KO match with the resolved real
  team on one side and `Sieger von #<n>` (or similar) on the unresolved
  side, if it hasn't been finished yet.
- The cards view text should show the player and card type you recorded.

If anything looks wrong, fix `data-mapping.js`/`app.js` and re-run — do not
proceed to Step 5 until this looks correct. Delete the throwaway script
when done: `rm /tmp/claude-scratch-verify-viewer.mjs`.

- [ ] **Step 5: Revert the local-testing edit to `supabase-client.js`**

```bash
git diff supabase-client.js
```

Expected: no output (the file must be back to pointing at the production
URL/anon key from Task 2 — if the diff shows anything, revert it:
`git checkout -- supabase-client.js`).

- [ ] **Step 6: Verify against production (read-only, no cleanup needed)**

The public viewer only ever reads data — verifying against the real
production Supabase project carries none of the write/cleanup risk the
admin-app Teilprojekte had. Serve the root site locally
(`npx http-server . -p 5051 -c-1`, `supabase-client.js` already points at
production) and open `http://127.0.0.1:5051` in a real browser (or reuse
the Step 4 throwaway script pattern, since it's already deleted, rewrite
it quickly if useful). Confirm:
- Standings show the real tournament's categories.
- At least one category with completed matches shows a plausible
  standings table.
- The Matches tab shows real matches with correct day/time/court/status.
- The Bracket tab renders the real KO structure, including any
  still-unresolved slots as `Sieger von #<n>` placeholders.
- The Cards tab shows real recorded cards (or the "No cautions recorded
  yet" empty state if none exist).

No commit needed for this step — it's a pure read-only verification.

---

## Self-Review Notes

- **Spec coverage:** minimal-invasive data-layer swap preserving all
  standings/render functions (Task 3), matches mapping incl. KO
  placeholder labels and `isRealTeam` fix (Task 1 + Task 3 Step 4), cards
  mapping from `player_events` (Task 1 + Task 3 Step 6), `config`
  read-with-fallback (Task 1's `rulesFromConfig` + Task 3 Step 7), 60s
  polling unchanged (untouched `CONFIG.refreshMs`/`setInterval` in the
  Boot section), single active tournament (`fetchTournament`'s
  `.limit(1).single()`), match ordering preserved via
  `.order('scheduled_time')` in `fetchMatches` — all covered. Out-of-scope
  items (live point-by-point, referee display, multi-tournament, Realtime,
  config-editing UI, Sheet fallback) are deliberately absent from every
  task.
- **Naming collision avoided:** `scripts/parse-sheet.mjs` (the Teilprojekt-1
  one-off migration script) already exports a function called `mapStatus`
  that maps in the OPPOSITE direction (sheet status → Supabase status, for
  importing historical data). This plan's equivalent function is
  deliberately named `statusLabel` instead of `mapStatus`, in a different
  file, to avoid a confusing same-name-opposite-direction pair existing in
  the same project.
- **Why `isRealTeam` moved into the tested module:** `app.js` has no test
  infrastructure of its own (it accesses `document`/`window` at module load
  time, so it can't run under `node --test`) and this Teilprojekt's spec
  explicitly requires updating `isRealTeam`'s logic (old heuristic matched
  English Sheet placeholders, new placeholders are German "Sieger
  von"/"Verlierer von" strings). Moving it into `data-mapping.js` (Task 1)
  is the only way to get real regression coverage on this specific,
  spec-mandated change — `app.js` keeps a one-line wrapper so every other
  call site in the file is untouched.
- **No database migration in this Teilprojekt:** `tournaments.config`
  already exists from Teilprojekt 1; this plan only adds a reader for it.
  No `supabase/migrations/` file, no `supabase db push` step — the only
  "deployment" is merging and pushing the static site, handled by
  `finishing-a-development-branch`.
- **Type consistency check:** `mapMatch`'s output shape
  (`day/time/nr/court/teamA/teamB/round/category/bestOf/setsA/setsB/
  pointsA/pointsB/sets/status`) matches exactly what `computeStandings`,
  `aggregate`, `renderStandings`, `renderCrossTable`, `renderKnockout`,
  `bracketNode`, `renderMatches`, `matchCard` already read from
  `state.matches` entries (verified against the current `app.js` read in
  full during this plan's research) — no `teamARaw`/`teamBRaw` fields,
  confirmed unused anywhere outside the deleted `rowToMatch`.
  `mapCautions`'s output shape matches `renderCards`/`cautionBadge`'s reads
  of `state.cautions` entries exactly. `rulesFromConfig`'s output shape
  matches what `rules()`/`matchPointsFor`/`computeStandings` already expect
  from `state.rules` (`pointTable`/`drawPoints`/`tiebreakers`), unchanged.
