# Teilprojekt 6: Admin-Redesign + Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the admin app with the viewer's design system, introduce a
global tournament/category context bar, extract shared UI helpers with
safe-by-default escaping, and harden security (vendored supabase-js, CSP).

**Architecture:** Two new modules carry the refactor: `admin/context.js`
(global tournament/category selection, persisted, change-notified) and
`admin/ui.js` (escaping-safe render helpers + toast/confirm/loading). All 9
screens are migrated to consume them; `admin/styles.css` is rewritten on the
viewer's design tokens. `supabase-js` moves from an esm.sh runtime import to
a pinned, vendored single-file ES module, which then allows a strict
meta-CSP on `admin/index.html`.

**Tech Stack:** Vanilla ES modules (no bundler for the app), `esbuild` as a
devDependency used only by the one-off vendoring script, `node --test`,
Playwright.

## Global Constraints

- Design tokens copied verbatim from the viewer's `styles.css` `:root`:
  `--bg: #0b1220; --bg-elev: #131c2e; --bg-elev-2: #1b2740;
  --line: #25324d; --text: #e8edf6; --muted: #93a2c0; --accent: #4f8cff;
  --accent-2: #22d3a6; --live: #ff4d6d; --gold: #f5c451;
  --radius: 14px; --shadow: 0 6px 24px rgba(0, 0, 0, 0.35);`
- Context-bar select IDs are exactly `#ctx_tournament` and `#ctx_category`
  (the e2e specs depend on them).
- Screen-local form field IDs (`#t_name`, `#c_name`, `#c_format`,
  `#team_name`, `#player_family_name`, `#match_team_a`, `#sg_start`,
  `#ref_name`, `#assign_referee`, `#card_player`, `#sub_player_out`,
  `#incident_type`, …) stay unchanged. Only the per-screen
  tournament/category selects disappear: `#c_tournament`,
  `#categoryTournamentSelect`, `#court_tournament`, `#team_tournament`,
  `#team_category`, `#player_tournament`, `#player_category`,
  `#match_tournament`, `#match_category`, `#sg_tournament`, `#sg_category`,
  `#ref_tournament`, `#gr_tournament`, `#gr_category`.
- Escaping is safe-by-default: all rendering of DB-sourced strings goes
  through `ui.js` helpers (`dataTable`, `selectOptions`, `emptyState`,
  `confirmDelete`) or explicit `escapeHtml()`. Raw HTML must be wrapped in
  `raw()` deliberately.
- No inline `<script>`, no inline `style=`, no HTML `onclick=` attributes —
  required by the CSP `default-src 'self'; style-src 'self'`.
- `admin/db.js` query functions unchanged; only `escapeHtml` moves to
  `ui.js` (re-exported from `db.js` so nothing breaks mid-migration).
- localStorage keys: `ems_tournament`, `ems_category`.
- No database/RLS changes. No behavior changes to schedule generator,
  referee auto-assignment, or game-report RPCs.
- Commit after every task; messages in the repo's existing
  `feat:`/`refactor:`/`test:` style.

## File Structure

- `scripts/vendor-supabase.mjs` (new) — one-off esbuild bundling of the
  installed `@supabase/supabase-js` into `vendor/supabase-js-<version>.mjs`.
- `vendor/supabase-js-2.110.0.mjs` (new, committed) — pinned single-file ESM
  bundle, served same-origin, shared by admin (this Teilprojekt) and viewer
  (Teilprojekt 7).
- `admin/ui.js` (new) — `escapeHtml`, `raw`, `dataTable`, `selectOptions`,
  `emptyState`, `loading`, `showToast`, `confirmDelete`.
- `admin/ui.test.mjs` (new) — unit tests incl. XSS fixtures.
- `admin/context.js` (new) — global context state + context-bar rendering.
- `admin/styles.css` (rewritten) — viewer tokens + admin components.
- `admin/index.html` (rewritten) — header, context bar, pill nav, login
  card, CSP meta tag.
- `admin/app.js` (modified) — `registerScreen(name, {render, context})`,
  context wiring, pill nav.
- `admin/screens/*.js` (all 9 modified) — context consumption + helpers.
- `admin/supabase-client.js` (modified) — vendored import.
- `tests/e2e/*.spec.mjs` (all 4 modified) — context-bar selection flow.
- `package.json` (modified) — `esbuild` devDependency, `test:unit` gains
  `admin/ui.test.mjs`.

## Execution Notes

- **E2E runs need** a running local stack and `SEED_ADMIN_PASSWORD` (see
  existing e2e specs). If the environment lacks them, run the named spec
  files anyway to confirm they fail only on missing credentials, and defer
  the green run to the final task on a machine with the stack.
- Tasks 6–11 migrate screens one at a time. Each task also rewrites the
  e2e lines that referenced the removed selects, so the suite is
  consistent again after each task.

---

### Task 1: Vendor supabase-js and switch the admin client

**Files:**
- Create: `scripts/vendor-supabase.mjs`
- Create: `vendor/supabase-js-2.110.0.mjs` (generated, committed)
- Modify: `package.json`
- Modify: `admin/supabase-client.js:1`

**Interfaces:**
- Produces: `vendor/supabase-js-<version>.mjs` exporting `createClient` —
  imported by `admin/supabase-client.js` now and by the viewer in
  Teilprojekt 7.

- [ ] **Step 1: Add esbuild devDependency**

Run: `npm install --save-dev esbuild`
Expected: `package.json` devDependencies gains `"esbuild"`.

- [ ] **Step 2: Write the vendoring script**

Create `scripts/vendor-supabase.mjs`:

```js
// One-off vendoring: bundles the installed @supabase/supabase-js into a
// single self-contained ES module served same-origin (no esm.sh at runtime).
// Re-run after upgrading the package:  node scripts/vendor-supabase.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8'),
);
const out = `vendor/supabase-js-${pkg.version}.mjs`;
execFileSync('npx', [
  'esbuild', 'node_modules/@supabase/supabase-js/dist/module/index.js',
  '--bundle', '--format=esm', '--target=es2020', `--outfile=${out}`,
], { stdio: 'inherit' });
console.log(`Wrote ${out}`);
```

- [ ] **Step 3: Generate the bundle**

Run: `node -p "require('@supabase/supabase-js/package.json').version"`
Expected: `2.110.0` (if the lockfile resolved a newer 2.x, use that exact
version in the filename and imports below — the file name must pin the real
installed version).

Run: `node scripts/vendor-supabase.mjs`
Expected: `Wrote vendor/supabase-js-2.110.0.mjs`, file is a few hundred KB.

- [ ] **Step 4: Smoke-test the bundle exports**

Run:
```bash
node --input-type=module -e "const m = await import('./vendor/supabase-js-2.110.0.mjs'); if (typeof m.createClient !== 'function') throw new Error('createClient missing'); console.log('ok');"
```
Expected: `ok`

- [ ] **Step 5: Switch the admin import**

In `admin/supabase-client.js` replace line 1:

```js
// old
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// new
import { createClient } from '../vendor/supabase-js-2.110.0.mjs';
```

**Note:** Playwright's webServer serves only `admin/` (`http-server admin`),
so `../vendor/` would 404 under e2e. Change `playwright.config.mjs`
webServer command to serve the repo root and adjust baseURL:

```js
use: {
  baseURL: 'http://127.0.0.1:5050/admin/',
},
webServer: {
  command: 'npx http-server . -p 5050 -c-1',
  url: 'http://127.0.0.1:5050/admin/',
  reuseExistingServer: !process.env.CI,
},
```

(`page.goto('/')` in the specs resolves against the trailing-slash baseURL
to `/admin/`, so the spec files need no change for this.)

- [ ] **Step 6: Verify admin still boots**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs`
Expected: login flow passes (or fails only on missing
`SEED_ADMIN_PASSWORD` if the stack isn't available — then verify manually:
`npx http-server . -p 5050` and open `http://127.0.0.1:5050/admin/`, login
screen renders, no console error about the module import).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/vendor-supabase.mjs vendor/ admin/supabase-client.js playwright.config.mjs
git commit -m "feat: vendor pinned supabase-js bundle, drop esm.sh runtime import in admin"
```

---

### Task 2: `admin/ui.js` — shared helpers with safe-by-default escaping

**Files:**
- Create: `admin/ui.js`
- Create: `admin/ui.test.mjs`
- Modify: `admin/db.js:9-12` (move `escapeHtml`, re-export)
- Modify: `package.json` (`test:unit`)

**Interfaces:**
- Produces (all exported from `admin/ui.js`):
  - `escapeHtml(str: any): string`
  - `raw(html: string): {html: string}` — opt-out wrapper for trusted HTML
  - `dataTable({columns: [{label, render(row) => value|{html}}], rows, emptyText?}): string`
  - `selectOptions(items, getValue(it), getLabel(it), selected?): string`
  - `emptyState(text: string): string`
  - `loading(): string`
  - `showToast(message: string, {type?: 'success'|'error'}): void`
  - `confirmDelete(message: string): Promise<boolean>`
- `admin/db.js` re-exports `escapeHtml` from `ui.js` (existing imports keep
  working until every screen is migrated).
- **Bewusste Abweichung von der Spec:** der dort skizzierte
  `entityForm`/`formRow`-Helfer entfällt (YAGNI) — die Formulare der
  Screens sind zu heterogen; Einheitlichkeit kommt aus der gemeinsamen
  `.entity-form`-CSS, Escaping der Option-Listen aus `selectOptions`.

- [ ] **Step 1: Write the failing tests**

Create `admin/ui.test.mjs` (only the DOM-free helpers are unit-tested;
`showToast`/`confirmDelete` are covered by e2e):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, raw, dataTable, selectOptions, emptyState } from './ui.js';

test('escapeHtml escapes all five metacharacters and stringifies nullish', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')" & more>`),
    '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot; &amp; more&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(7), '7');
});

test('dataTable escapes cell values by default (attack fixture)', () => {
  const html = dataTable({
    columns: [{ label: 'Name', render: (r) => r.name }],
    rows: [{ name: '<img src=x onerror=alert(1)>' }],
  });
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

test('dataTable lets raw() HTML through deliberately', () => {
  const html = dataTable({
    columns: [{ label: '', render: (r) => raw(`<button data-delete="${r.id}">X</button>`) }],
    rows: [{ id: 'abc' }],
  });
  assert.ok(html.includes('<button data-delete="abc">X</button>'));
});

test('dataTable escapes column labels and renders emptyText for zero rows', () => {
  const html = dataTable({ columns: [{ label: '<b>N</b>', render: (r) => r.n }], rows: [] , emptyText: 'Nix'});
  assert.ok(html.includes('Nix'));
  const withRows = dataTable({ columns: [{ label: '<b>N</b>', render: (r) => r.n }], rows: [{ n: 1 }] });
  assert.ok(withRows.includes('&lt;b&gt;N&lt;/b&gt;'));
});

test('selectOptions escapes values/labels and marks the selected item', () => {
  const html = selectOptions(
    [{ id: 'a"b', name: '<Team>' }, { id: 'c', name: 'C' }],
    (t) => t.id, (t) => t.name, 'c');
  assert.ok(html.includes('value="a&quot;b"'));
  assert.ok(html.includes('&lt;Team&gt;'));
  assert.ok(html.includes('<option value="c" selected>C</option>'));
});

test('emptyState escapes its text', () => {
  assert.ok(emptyState('<x>').includes('&lt;x&gt;'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test admin/ui.test.mjs`
Expected: FAIL — `Cannot find module ... admin/ui.js`

- [ ] **Step 3: Implement `admin/ui.js`**

```js
// Shared UI helpers for all admin screens. Rendering goes through these so
// HTML-escaping is the default and cannot be forgotten: every value is
// escaped unless explicitly wrapped with raw().

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

export function raw(html) { return { html }; }

function toHtml(value) {
  if (value && typeof value === 'object' && 'html' in value) return value.html;
  return escapeHtml(value);
}

export function dataTable({ columns, rows, emptyText = 'Keine Einträge.' }) {
  if (!rows.length) return emptyState(emptyText);
  return `<div class="table-wrap"><table>
    <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) =>
      `<tr>${columns.map((c) => `<td>${toHtml(c.render(row))}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table></div>`;
}

export function selectOptions(items, getValue, getLabel, selected) {
  return items.map((it) => {
    const v = String(getValue(it));
    const sel = v === String(selected ?? '') ? ' selected' : '';
    return `<option value="${escapeHtml(v)}"${sel}>${escapeHtml(getLabel(it))}</option>`;
  }).join('');
}

export function emptyState(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

export function loading() {
  return '<div class="empty loading-state">Laden…</div>';
}

let toastTimer = null;
export function showToast(message, { type = 'success' } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast toast--${type}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (type === 'success') {
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  } else {
    el.onclick = () => { el.hidden = true; };
  }
}

export function confirmDelete(message) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" data-cancel>Abbrechen</button>
          <button type="button" class="btn btn--danger" data-confirm>Löschen</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (result) => { wrap.remove(); resolve(result); };
    wrap.querySelector('[data-cancel]').onclick = () => done(false);
    wrap.querySelector('[data-confirm]').onclick = () => done(true);
    wrap.onclick = (e) => { if (e.target === wrap) done(false); };
  });
}
```

- [ ] **Step 4: Move `escapeHtml` out of `db.js`**

In `admin/db.js`, delete lines 3–12 (the comment block, `HTML_ESCAPE_MAP`,
and `escapeHtml`) and add at the top (below the existing import):

```js
// escapeHtml lives in ui.js now (safe-by-default helpers). Re-exported here
// so screens can migrate one at a time.
export { escapeHtml } from './ui.js';
```

- [ ] **Step 5: Run tests**

Run: `node --test admin/ui.test.mjs`
Expected: all PASS.

Add `admin/ui.test.mjs` to `package.json` `test:unit` (append to the file
list). Run `npm run test:unit` — everything green.

- [ ] **Step 6: Commit**

```bash
git add admin/ui.js admin/ui.test.mjs admin/db.js package.json
git commit -m "feat: add admin ui helpers with safe-by-default escaping"
```

---

### Task 3: `admin/context.js` — global tournament/category context

**Files:**
- Create: `admin/context.js`

**Interfaces:**
- Consumes: `listTournaments()`, `listCategories(tournamentId)` from
  `db.js`; `selectOptions` from `ui.js`; DOM elements `#ctx_tournament`,
  `#ctx_category` (created in Task 4).
- Produces: `initContext(): Promise<void>`,
  `refreshContext(): Promise<void>` (re-reads tournaments+categories after
  creates), `getTournamentId(): string|null`,
  `getCategoryId(): string|null`, `getTournaments(): Tournament[]`,
  `getCategories(): Category[]`, `onContextChange(fn): void`,
  `setContextMode(mode: 'none'|'tournament'|'category'): void`.

- [ ] **Step 1: Implement `admin/context.js`**

```js
import { listTournaments, listCategories } from './db.js';
import { selectOptions } from './ui.js';

// Global tournament/category selection shared by all screens. Persisted so
// the choice survives reloads; screens re-render via onContextChange.
const KEY_T = 'ems_tournament';
const KEY_C = 'ems_category';

let tournaments = [];
let categories = [];
let tournamentId = null;
let categoryId = null;
const listeners = [];

export function getTournamentId() { return tournamentId; }
export function getCategoryId() { return categoryId; }
export function getTournaments() { return tournaments; }
export function getCategories() { return categories; }
export function onContextChange(fn) { listeners.push(fn); }
function notify() { for (const fn of listeners) fn({ tournamentId, categoryId }); }

// Greys out the selects the active screen doesn't use — the bar itself
// never disappears, so the layout stays stable across screens.
export function setContextMode(mode) {
  document.getElementById('ctx_tournament').disabled = mode === 'none';
  document.getElementById('ctx_category').disabled = mode !== 'category';
}

function renderSelects() {
  document.getElementById('ctx_tournament').innerHTML = tournaments.length
    ? selectOptions(tournaments, (t) => t.id, (t) => t.name, tournamentId)
    : '<option value="">— kein Turnier —</option>';
  document.getElementById('ctx_category').innerHTML = categories.length
    ? selectOptions(categories, (c) => c.id, (c) => c.name, categoryId)
    : '<option value="">—</option>';
}

async function loadCategories() {
  categories = tournamentId ? await listCategories(tournamentId) : [];
  const stored = localStorage.getItem(KEY_C);
  categoryId = categories.some((c) => c.id === stored) ? stored : (categories[0]?.id ?? null);
  if (categoryId) localStorage.setItem(KEY_C, categoryId);
  renderSelects();
}

export async function refreshContext() {
  tournaments = await listTournaments();
  if (!tournaments.some((t) => t.id === tournamentId)) {
    tournamentId = tournaments[0]?.id ?? null;
    if (tournamentId) localStorage.setItem(KEY_T, tournamentId);
  }
  await loadCategories();
}

export async function initContext() {
  tournaments = await listTournaments();
  const stored = localStorage.getItem(KEY_T);
  tournamentId = tournaments.some((t) => t.id === stored) ? stored : (tournaments[0]?.id ?? null);
  if (tournamentId) localStorage.setItem(KEY_T, tournamentId);
  await loadCategories();

  document.getElementById('ctx_tournament').onchange = async (e) => {
    tournamentId = e.target.value;
    localStorage.setItem(KEY_T, tournamentId);
    localStorage.removeItem(KEY_C); // category belongs to the old tournament
    await loadCategories();
    notify();
  };
  document.getElementById('ctx_category').onchange = (e) => {
    categoryId = e.target.value;
    localStorage.setItem(KEY_C, categoryId);
    notify();
  };
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check admin/context.js`
Expected: no output (exit 0). Behavior is verified end-to-end in Tasks 5–12.

- [ ] **Step 3: Commit**

```bash
git add admin/context.js
git commit -m "feat: add global tournament/category context module for admin"
```

---

### Task 4: Rewrite `admin/styles.css` on the viewer design tokens

**Files:**
- Rewrite: `admin/styles.css`

**Interfaces:**
- Produces the class vocabulary all later tasks use: `.app-header`,
  `.header-inner`, `.brand`, `.brand-logo`, `.context-bar`, `.ctx-field`,
  `.admin-nav`, `.pill`, `.is-active`, `.panel`, `.table-wrap`,
  `.entity-form`, `.btn`, `.btn--danger`, `.btn--ghost`, `.error`,
  `.warning`, `.empty`, `.loading-state`, `.toast`, `.toast--success`,
  `.toast--error`, `.modal-backdrop`, `.modal`, `.modal-actions`,
  `.login-wrap`, `.login-card`, `.gr-score`, `.gr-point-btn`.

- [ ] **Step 1: Replace `admin/styles.css` entirely**

```css
:root {
  --bg: #0b1220;
  --bg-elev: #131c2e;
  --bg-elev-2: #1b2740;
  --line: #25324d;
  --text: #e8edf6;
  --muted: #93a2c0;
  --accent: #4f8cff;
  --accent-2: #22d3a6;
  --live: #ff4d6d;
  --gold: #f5c451;
  --radius: 14px;
  --shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ---------- Login ---------- */
.login-wrap { min-height: 100dvh; display: grid; place-items: center; padding: 16px; }
.login-card {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 28px 24px;
  width: min(360px, 100%);
  display: flex; flex-direction: column; gap: 12px;
}
.login-card h1 { font-size: 18px; margin: 0 0 4px; }
.login-card label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }

/* ---------- Header + context bar + nav ---------- */
.app-header {
  position: sticky; top: 0; z-index: 20;
  background: linear-gradient(180deg, #0e1830, #0b1220);
  border-bottom: 1px solid var(--line);
}
.header-inner {
  max-width: 1100px; margin: 0 auto; padding: 10px 16px;
  display: flex; align-items: center; gap: 12px;
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.brand-logo {
  width: 38px; height: 38px; display: grid; place-items: center;
  background: #fff; border-radius: 10px; flex: none;
}
.brand-logo img { width: 100%; height: 100%; object-fit: contain; padding: 3px; }
.brand h1 { font-size: 15px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.role-label { font-size: 12px; color: var(--muted); white-space: nowrap; }

.context-bar {
  max-width: 1100px; margin: 0 auto; padding: 8px 16px;
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  border-top: 1px solid var(--line);
}
.ctx-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.ctx-field select { min-width: 140px; }

.admin-nav {
  max-width: 1100px; margin: 0 auto; padding: 8px 16px;
  display: flex; gap: 8px; overflow-x: auto;
  -webkit-overflow-scrolling: touch; scrollbar-width: none;
  border-top: 1px solid var(--line);
}
.admin-nav::-webkit-scrollbar { display: none; }
.pill {
  flex: none; padding: 7px 14px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--bg-elev);
  color: var(--muted); font-size: 13px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.pill:hover { color: var(--text); }
.pill.is-active { background: var(--accent); border-color: var(--accent); color: #fff; }

/* ---------- Content ---------- */
#main { max-width: 1100px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
#main h2 { margin: 0; font-size: 18px; }
#main h3 { margin: 0; font-size: 15px; color: var(--muted); }

.panel {
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
}

/* ---------- Tables ---------- */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
thead th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; background: var(--bg-elev-2); }
tbody tr:last-child td { border-bottom: none; }

/* ---------- Forms & buttons ---------- */
input, select, textarea {
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--bg-elev-2); color: var(--text); font: inherit;
}
input:disabled, select:disabled { opacity: 0.45; cursor: not-allowed; }
form.entity-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
form.entity-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
fieldset { border: 1px solid var(--line); border-radius: 10px; display: flex; gap: 10px; flex-wrap: wrap; }
legend { font-size: 12px; color: var(--muted); padding: 0 6px; }

.btn, button {
  padding: 8px 14px; border-radius: 8px; border: 1px solid transparent;
  background: var(--accent); color: #fff; font: inherit; cursor: pointer;
  min-height: 38px;
}
.btn--danger { background: var(--live); }
.btn--ghost { background: transparent; border-color: var(--line); color: var(--text); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.error { color: #f87171; font-size: 13px; margin: 0; }
.warning { color: var(--gold); font-size: 13px; margin: 0; }
.empty { color: var(--muted); padding: 20px; text-align: center; font-size: 14px; }

/* ---------- Toast & modal ---------- */
.toast {
  position: fixed; z-index: 50; bottom: 16px; right: 16px;
  padding: 12px 16px; border-radius: 10px; box-shadow: var(--shadow);
  font-size: 14px; max-width: min(420px, calc(100vw - 32px));
}
.toast--success { background: var(--accent-2); color: #04231a; }
.toast--error { background: var(--live); color: #fff; cursor: pointer; }

.modal-backdrop {
  position: fixed; inset: 0; z-index: 40;
  background: rgba(4, 8, 16, 0.65);
  display: grid; place-items: center; padding: 16px;
}
.modal {
  background: var(--bg-elev); border: 1px solid var(--line);
  border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 20px; width: min(400px, 100%);
}
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }

/* ---------- Game report (touch) ---------- */
.gr-score { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.gr-point-btn { min-height: 56px; font-size: 16px; font-weight: 700; }

/* ---------- Mobile ---------- */
@media (max-width: 640px) {
  .gr-score { grid-template-columns: 1fr; }
  form.entity-form { flex-direction: column; align-items: stretch; }
  .toast { left: 16px; right: 16px; bottom: 16px; }
}
```

- [ ] **Step 2: Visual sanity check**

Run: `npx http-server . -p 5050 -c-1` and open
`http://127.0.0.1:5050/admin/`. The old markup won't match the new classes
yet (Task 5 fixes that) — just confirm the page still loads with dark
background and no 404 on the stylesheet.

- [ ] **Step 3: Commit**

```bash
git add admin/styles.css
git commit -m "feat: rewrite admin stylesheet on viewer design tokens"
```

---

### Task 5: New `admin/index.html` + `admin/app.js` shell (header, context bar, pill nav, login card, CSP)

**Files:**
- Rewrite: `admin/index.html`
- Modify: `admin/app.js`

**Interfaces:**
- Consumes: `initContext`, `setContextMode`, `onContextChange` (Task 3).
- Produces: `registerScreen(name, {render, context})` where `context` is
  `'none'|'tournament'|'category'` (default `'category'`) — all screen
  tasks rely on this signature. `showScreen(name)` unchanged in signature.

- [ ] **Step 1: Rewrite `admin/index.html`**

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' https://obujvbiwqspdnewetgyi.supabase.co; img-src 'self' data:; style-src 'self'; base-uri 'none'; object-src 'none'">
  <title>Fistball EMS — Admin</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="loginView" class="login-wrap">
    <form id="loginForm" class="login-card">
      <h1>Fistball EMS — Admin</h1>
      <label>E-Mail<input id="email" type="email" required autocomplete="username"></label>
      <label>Passwort<input id="password" type="password" required autocomplete="current-password"></label>
      <button type="submit" class="btn">Login</button>
      <p id="loginError" class="error" hidden></p>
    </form>
  </div>
  <div id="appView" hidden>
    <header class="app-header">
      <div class="header-inner">
        <div class="brand">
          <div class="brand-logo" aria-hidden="true"><img src="../assets/ifa-mark.svg" alt=""></div>
          <h1>Fistball EMS — Admin</h1>
        </div>
        <span id="roleLabel" class="role-label"></span>
        <button id="logoutBtn" class="btn btn--ghost">Logout</button>
      </div>
      <div class="context-bar">
        <label class="ctx-field">Turnier
          <select id="ctx_tournament"></select>
        </label>
        <label class="ctx-field">Kategorie
          <select id="ctx_category"></select>
        </label>
      </div>
      <nav id="nav" class="admin-nav"></nav>
    </header>
    <main id="main"></main>
  </div>
  <script type="module" src="app.js"></script>
  <script type="module" src="screens/tournaments.js"></script>
  <script type="module" src="screens/categories.js"></script>
  <script type="module" src="screens/courts.js"></script>
  <script type="module" src="screens/teams.js"></script>
  <script type="module" src="screens/matches.js"></script>
  <script type="module" src="screens/schedule.js"></script>
  <script type="module" src="screens/referees.js"></script>
  <script type="module" src="screens/players.js"></script>
  <script type="module" src="screens/game-report.js"></script>
</body>
</html>
```

Notes: `hidden` on `#loginView` interacts with `display: grid` — add
`.login-wrap[hidden] { display: none; }` to `admin/styles.css` in this step:

```css
.login-wrap[hidden] { display: none; }
```

(GitHub Pages serves the repo root, so `../assets/ifa-mark.svg` and the
CSP `'self'` sources resolve; same for the local root http-server.)

- [ ] **Step 2: Rewrite `admin/app.js`**

```js
import { signIn, signOut, getSessionRole } from './supabase-client.js';
import { initContext, onContextChange, setContextMode } from './context.js';

const screens = new Map();
let currentRole = null;
let currentScreen = null;

export function registerScreen(name, { render, context = 'category' }) {
  screens.set(name, { render, context });
}

export async function showScreen(name) {
  const screen = screens.get(name);
  if (!screen) throw new Error(`Unknown screen: ${name}`);
  currentScreen = name;
  setContextMode(screen.context);
  const main = document.getElementById('main');
  main.innerHTML = '';
  await screen.render(main, { role: currentRole });
  document.querySelectorAll('#nav button').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.screen === name);
  });
}

function renderNav() {
  const nav = document.getElementById('nav');
  const items = [
    ['tournaments', 'Turnier'],
    ['categories', 'Kategorien'],
    ['courts', 'Courts'],
    ['teams', 'Teams'],
    ['players', 'Kader'],
    ['matches', 'Matches'],
    ['schedule', 'Spielplan'],
    ['referees', 'Schiedsrichter'],
    ['game-report', 'Game Report'],
  ];
  nav.innerHTML = items.map(([key, label]) =>
    `<button class="pill" data-screen="${key}">${label}</button>`).join('');
  nav.querySelectorAll('button[data-screen]').forEach((b) => {
    b.onclick = () => showScreen(b.dataset.screen);
  });
}

async function boot() {
  const role = await getSessionRole();
  currentRole = role;
  const loginView = document.getElementById('loginView');
  const appView = document.getElementById('appView');

  if (!role) {
    loginView.hidden = false;
    appView.hidden = true;
    const form = document.getElementById('loginForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const error = await signIn(email, password);
      const errorEl = document.getElementById('loginError');
      if (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
        return;
      }
      location.reload();
    };
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  renderNav();
  document.getElementById('roleLabel').textContent = `Angemeldet als: ${role}`;
  document.getElementById('logoutBtn').onclick = async () => {
    await signOut();
    location.reload();
  };
  await initContext();
  onContextChange(() => { if (currentScreen) showScreen(currentScreen); });
  await showScreen('tournaments');
}

boot();
```

(The logout button moved from the nav into the header — the old
`renderNav` appended it as a nav item.)

- [ ] **Step 3: Manual smoke test**

Serve the root, open `/admin/`: login card centered in the new style; after
login (if stack available) the header, context bar (populated selects), and
pill nav render; screens still work with their own (soon to be removed)
selects. Browser console shows **no CSP violations**.

- [ ] **Step 4: Commit**

```bash
git add admin/index.html admin/app.js admin/styles.css
git commit -m "feat: admin shell with context bar, pill nav, login card and CSP"
```

---

### Task 6: Migrate simple tournament-level screens (tournaments, categories, courts)

**Files:**
- Rewrite: `admin/screens/tournaments.js`
- Rewrite: `admin/screens/categories.js`
- Rewrite: `admin/screens/courts.js`
- Modify: `tests/e2e/admin-flows.spec.mjs`, `tests/e2e/game-report-flows.spec.mjs`, `tests/e2e/matches-sources.spec.mjs`, `tests/e2e/referees-flows.spec.mjs` (lines using `#c_tournament`)

**Interfaces:**
- Consumes: `registerScreen` (Task 5 signature), `getTournamentId`,
  `refreshContext` (Task 3), `dataTable`, `selectOptions`, `showToast`,
  `emptyState`, `loading`, `escapeHtml`, `raw` (Task 2).

- [ ] **Step 1: Rewrite `admin/screens/tournaments.js`**

```js
import { registerScreen, showScreen } from '../app.js';
import { listTournaments, createTournament } from '../db.js';
import { dataTable, showToast } from '../ui.js';
import { refreshContext } from '../context.js';

async function render(main) {
  const tournaments = await listTournaments();
  main.innerHTML = `
    <h2>Turniere</h2>
    <div class="panel">
      ${dataTable({
        columns: [
          { label: 'Name', render: (t) => t.name },
          { label: 'Start', render: (t) => t.start_date },
          { label: 'Ende', render: (t) => t.end_date },
        ],
        rows: tournaments,
        emptyText: 'Noch kein Turnier angelegt.',
      })}
      <form id="tournamentForm" class="entity-form">
        <label>Name<input id="t_name" required></label>
        <label>Start<input id="t_start" type="date" required></label>
        <label>Ende<input id="t_end" type="date" required></label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;
  document.getElementById('tournamentForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createTournament({
        name: document.getElementById('t_name').value.trim(),
        start_date: document.getElementById('t_start').value,
        end_date: document.getElementById('t_end').value,
      });
      await refreshContext();
      showToast('Turnier angelegt.');
      await showScreen('tournaments');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('tournaments', { render, context: 'none' });
```

- [ ] **Step 2: Rewrite `admin/screens/categories.js`**

```js
import { registerScreen, showScreen } from '../app.js';
import { listCategories, createCategory } from '../db.js';
import { dataTable, emptyState, showToast } from '../ui.js';
import { getTournamentId, refreshContext } from '../context.js';

async function render(main) {
  const tournamentId = getTournamentId();
  if (!tournamentId) {
    main.innerHTML = `<h2>Kategorien</h2>${emptyState('Lege zuerst ein Turnier an (Screen „Turnier“).')}`;
    return;
  }
  const categories = await listCategories(tournamentId);
  main.innerHTML = `
    <h2>Kategorien</h2>
    <div class="panel">
      ${dataTable({
        columns: [
          { label: 'Name', render: (c) => c.name },
          { label: 'Format', render: (c) => c.format },
        ],
        rows: categories,
        emptyText: 'Noch keine Kategorien in diesem Turnier.',
      })}
      <form id="categoryForm" class="entity-form">
        <label>Name<input id="c_name" required></label>
        <label>Format
          <select id="c_format">
            <option value="round_robin">Round Robin</option>
            <option value="knockout">Knockout</option>
          </select>
        </label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;
  document.getElementById('categoryForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createCategory({
        tournament_id: tournamentId,
        name: document.getElementById('c_name').value.trim(),
        format: document.getElementById('c_format').value,
      });
      await refreshContext();
      showToast('Kategorie angelegt.');
      await showScreen('categories');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('categories', { render, context: 'tournament' });
```

- [ ] **Step 3: Rewrite `admin/screens/courts.js`**

```js
import { registerScreen, showScreen } from '../app.js';
import { listCourts, createCourt } from '../db.js';
import { dataTable, emptyState, showToast } from '../ui.js';
import { getTournamentId } from '../context.js';

async function render(main) {
  const tournamentId = getTournamentId();
  if (!tournamentId) {
    main.innerHTML = `<h2>Courts</h2>${emptyState('Lege zuerst ein Turnier an (Screen „Turnier“).')}`;
    return;
  }
  const courts = await listCourts(tournamentId);
  main.innerHTML = `
    <h2>Courts</h2>
    <div class="panel">
      ${dataTable({
        columns: [{ label: 'Name', render: (c) => c.name }],
        rows: courts,
        emptyText: 'Noch keine Courts in diesem Turnier.',
      })}
      <form id="courtForm" class="entity-form">
        <label>Name<input id="court_name" required></label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;
  document.getElementById('courtForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createCourt({ tournament_id: tournamentId, name: document.getElementById('court_name').value.trim() });
      showToast('Court angelegt.');
      await showScreen('courts');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('courts', { render, context: 'tournament' });
```

- [ ] **Step 4: Update e2e lines that used `#c_tournament` / `#categoryTournamentSelect` / `#court_tournament`**

Every spec that created a tournament and then selected it on the categories
screen now selects it in the context bar instead. Pattern (apply to each
occurrence; tournament labels differ per spec):

```js
// old
await page.click('button[data-screen=categories]');
await page.selectOption('#c_tournament', { label: 'Game Report Test Tournament' });
// new
await page.selectOption('#ctx_tournament', { label: 'Game Report Test Tournament' });
await page.click('button[data-screen=categories]');
```

Occurrences: `admin-flows.spec.mjs` (categories test),
`game-report-flows.spec.mjs:24-25`, `matches-sources.spec.mjs:23-24`,
`referees-flows.spec.mjs` (its setup block).

- [ ] **Step 5: Run the affected e2e specs**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs`
Expected: tournament + category tests PASS (teams/matches tests may still
pass since those screens are unchanged and still have their own selects —
their selects populate independently of the context bar).

- [ ] **Step 6: Commit**

```bash
git add admin/screens/tournaments.js admin/screens/categories.js admin/screens/courts.js tests/e2e/
git commit -m "refactor: migrate tournaments/categories/courts screens to context bar and ui helpers"
```

---

### Task 7: Migrate teams + players screens (category level, with delete confirmation)

**Files:**
- Rewrite: `admin/screens/teams.js`
- Rewrite: `admin/screens/players.js`
- Modify: e2e lines using `#team_tournament`, `#team_category`,
  `#player_tournament`, `#player_category`

**Interfaces:**
- Consumes: `getCategoryId` (Task 3), `dataTable`, `raw`, `selectOptions`,
  `confirmDelete`, `showToast`, `emptyState` (Task 2).
- Produces: teams screen keeps `#team_name`, `#team_short_name`; players
  screen keeps `#player_team` (team choice stays screen-local — the context
  ends at category level) and all `#player_*` form fields.

- [ ] **Step 1: Rewrite `admin/screens/teams.js`**

```js
import { registerScreen, showScreen } from '../app.js';
import { listTeams, createTeam, deleteTeam } from '../db.js';
import { dataTable, raw, emptyState, confirmDelete, showToast, escapeHtml } from '../ui.js';
import { getCategoryId } from '../context.js';

async function render(main) {
  const categoryId = getCategoryId();
  if (!categoryId) {
    main.innerHTML = `<h2>Teams</h2>${emptyState('Wähle oben Turnier und Kategorie (bzw. lege sie zuerst an).')}`;
    return;
  }
  const teams = await listTeams(categoryId);
  main.innerHTML = `
    <h2>Teams</h2>
    <div class="panel">
      ${dataTable({
        columns: [
          { label: 'Name', render: (t) => t.name },
          { label: 'Kurzname', render: (t) => t.short_name || '' },
          { label: '', render: (t) => raw(`<button class="btn btn--ghost" data-delete="${escapeHtml(t.id)}">Löschen</button>`) },
        ],
        rows: teams,
        emptyText: 'Noch keine Teams in dieser Kategorie.',
      })}
      <form id="teamForm" class="entity-form">
        <label>Name<input id="team_name" required></label>
        <label>Kurzname<input id="team_short_name"></label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;

  main.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!await confirmDelete('Team wirklich löschen?')) return;
      try {
        await deleteTeam(btn.dataset.delete);
        await showScreen('teams');
      } catch (err) {
        showToast(`Löschen fehlgeschlagen (vermutlich noch mit Matches verknüpft): ${err.message}`, { type: 'error' });
      }
    };
  });

  document.getElementById('teamForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createTeam({
        category_id: categoryId,
        name: document.getElementById('team_name').value.trim(),
        short_name: document.getElementById('team_short_name').value.trim(),
      });
      showToast('Team angelegt.');
      await showScreen('teams');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('teams', { render });
```

- [ ] **Step 2: Rewrite `admin/screens/players.js`**

Same pattern: drop `#player_tournament`/`#player_category`; keep a
screen-local `#player_team` select fed from `listTeams(getCategoryId())`;
table via `dataTable` with columns Nr / Name / Rolle / Position/Staff-Rolle
/ delete-`raw()`-button; delete goes through
`confirmDelete('Spieler wirklich löschen?')` with the existing
"vermutlich noch mit Karten/Wechseln verknüpft" error text via
`showToast(..., {type: 'error'})`; create form unchanged fields
(`#player_family_name`, `#player_given_name`, `#player_role`,
`#player_jersey_number`, `#player_position`, `#player_staff_role`),
submits with `team_id: document.getElementById('player_team').value`,
then re-renders via `showScreen('players')`. Empty states:
no category → `emptyState('Wähle oben Turnier und Kategorie.')`;
no teams → `emptyState('Noch keine Teams in dieser Kategorie — lege zuerst Teams an.')`.
Team options built with
`selectOptions(teams, (t) => t.id, (t) => t.name, previousSelection)` where
`previousSelection` is kept in a module-level `let lastTeamId = null;` so
the team choice survives the re-render after creating a player
(`registerScreen('players', { render })` — default category context).

- [ ] **Step 3: Update e2e team/player selection lines**

Pattern (in `admin-flows.spec.mjs`, `game-report-flows.spec.mjs`,
`matches-sources.spec.mjs`, `referees-flows.spec.mjs`):

```js
// old
await page.click('button[data-screen=teams]');
await page.selectOption('#team_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#team_category', { label: 'Game Report Category' });
// new
await page.selectOption('#ctx_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#ctx_category', { label: 'Game Report Category' });
await page.click('button[data-screen=teams]');
```

```js
// old
await page.click('button[data-screen=players]');
await page.selectOption('#player_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#player_category', { label: 'Game Report Category' });
await page.selectOption('#player_team', { label: 'Game Report Team A' });
// new
await page.selectOption('#ctx_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#ctx_category', { label: 'Game Report Category' });
await page.click('button[data-screen=players]');
await page.selectOption('#player_team', { label: 'Game Report Team A' });
```

Delete flows in the specs (if any click `[data-delete]`) must now confirm:

```js
await page.click('[data-delete]');
await page.click('.modal [data-confirm]');
```

- [ ] **Step 4: Run affected e2e**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/screens/teams.js admin/screens/players.js tests/e2e/
git commit -m "refactor: migrate teams/players screens to context bar with delete confirmation"
```

---

### Task 8: Migrate matches screen

**Files:**
- Modify: `admin/screens/matches.js`
- Modify: e2e lines using `#match_tournament` / `#match_category`

**Interfaces:**
- Consumes: `getTournamentId`, `getCategoryId`, `dataTable`, `raw`,
  `selectOptions`, `showToast`, `emptyState`, `escapeHtml`.

- [ ] **Step 1: Apply these edits to `admin/screens/matches.js`**

1. Imports: drop `listTournaments`, `listCategories`; add
   `import { getTournamentId, getCategoryId } from '../context.js';` and
   `import { dataTable, raw, selectOptions, showToast, emptyState, escapeHtml } from '../ui.js';`
   (keep `escapeHtml` coming from `ui.js`, not `db.js`).
2. `sourceLabel()` stays, **but its output is now always escaped at the
   call sites via `dataTable`'s default escaping** (this closes the spec's
   known gap: `round_label` was interpolated unescaped).
3. Remove the `#match_tournament`/`#match_category` labels from the
   template and the `refreshCategories` function; replace
   `currentTournamentId`/`currentCategoryId` initialisation with
   `const currentTournamentId = getTournamentId();
    const currentCategoryId = getCategoryId();`
   and guard at the top:

```js
if (!getCategoryId()) {
  main.innerHTML = `<h2>Matches</h2>${emptyState('Wähle oben Turnier und Kategorie.')}`;
  return;
}
```

4. `RACE_GUARDED_SELECT_IDS` shrinks to
   `['match_team_a', 'match_team_a_source', 'match_team_b', 'match_team_b_source', 'match_court']`
   and both `onchange` handlers for the removed selects are deleted;
   the initial-load block at the bottom becomes:

```js
setRaceGuardedSelectsDisabled(true);
try {
  await refreshSourceOptions(currentTournamentId);
  await refreshTeamsAndCourts(currentTournamentId, currentCategoryId);
  await renderTable();
} finally {
  setRaceGuardedSelectsDisabled(false);
}
```

5. `renderTable()` builds its table with `dataTable`:

```js
const matches = currentCategoryId ? await listMatches(currentCategoryId) : [];
document.getElementById('matchTableWrap').innerHTML = dataTable({
  columns: [
    { label: 'Team A', render: (m) => m.team_a ? m.team_a.name : raw(`<em>${escapeHtml(sourceLabel(m.team_a_source_match, m.team_a_source_outcome))}</em>`) },
    { label: 'Team B', render: (m) => m.team_b ? m.team_b.name : raw(`<em>${escapeHtml(sourceLabel(m.team_b_source_match, m.team_b_source_outcome))}</em>`) },
    { label: 'Runde', render: (m) => m.round_label ?? '' },
    { label: 'Court', render: (m) => m.court?.name ?? '' },
    { label: 'Status', render: (m) => m.status },
    { label: '', render: (m) => role === 'admin' && m.status !== 'finished' && m.team_a_id && m.team_b_id
        ? raw(`<button class="btn" data-finish="${escapeHtml(m.id)}">Finished</button>
               <button class="btn btn--ghost" data-forfeit-toggle="${escapeHtml(m.id)}">Forfeit</button>
               <span id="forfeit-${escapeHtml(m.id)}" hidden>
                 <button class="btn btn--danger" data-forfeit-winner="${escapeHtml(m.id)}|${escapeHtml(m.team_a_id)}">${escapeHtml(m.team_a.name)} gewinnt</button>
                 <button class="btn btn--danger" data-forfeit-winner="${escapeHtml(m.id)}|${escapeHtml(m.team_b_id)}">${escapeHtml(m.team_b.name)} gewinnt</button>
               </span>`)
        : '' },
  ],
  rows: matches,
  emptyText: 'Noch keine Matches in dieser Kategorie.',
});
```

   The `data-finish`/`data-forfeit-*` click handlers stay as they are, but
   report errors via `showToast(err.message, { type: 'error' })` instead of
   `#matchListError` (remove that `<p>`).
6. The create-form (`#matchForm`) template keeps all its fields; wrap the
   table and the form each in `<div class="panel">…</div>`; submit errors
   go to `showToast`; team/court/source option lists are built with
   `selectOptions` instead of hand-rolled `<option>` strings.
7. Registration: `registerScreen('matches', { render });` (category is the
   default context).

- [ ] **Step 2: Update e2e**

```js
// old
await page.click('button[data-screen=matches]');
await page.selectOption('#match_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#match_category', { label: 'Game Report Category' });
// new
await page.selectOption('#ctx_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#ctx_category', { label: 'Game Report Category' });
await page.click('button[data-screen=matches]');
```

Apply in `game-report-flows.spec.mjs`, `matches-sources.spec.mjs`,
`admin-flows.spec.mjs`, `referees-flows.spec.mjs`.

- [ ] **Step 3: Run affected e2e**

Run: `npx playwright test tests/e2e/matches-sources.spec.mjs tests/e2e/admin-flows.spec.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add admin/screens/matches.js tests/e2e/
git commit -m "refactor: migrate matches screen to context bar, escape source labels"
```

---

### Task 9: Migrate schedule screen

**Files:**
- Modify: `admin/screens/schedule.js`

**Interfaces:**
- Consumes: `getTournamentId`, `getCategoryId`, `dataTable`, `raw`,
  `showToast`, `emptyState`, `escapeHtml`.

- [ ] **Step 1: Apply these edits**

1. Drop `listTournaments`/`listCategories` imports, the
   `#sg_tournament`/`#sg_category` labels, `refreshCategories`, and
   `selectTournament`; read
   `const currentTournamentId = getTournamentId();
    const currentCategoryId = getCategoryId();` once, guard with
   `emptyState('Wähle oben Turnier und Kategorie.')` when either is null
   (keep the existing `role !== 'admin'` guard first).
2. `refreshCourts(currentTournamentId)` is called directly during render.
3. Wrap the generator controls and the preview each in
   `<div class="panel">`.
4. The preview table becomes a `dataTable` call (columns Team A / Team B /
   Court / Zeit — Zeit uses the existing
   `new Date(a.scheduledTime).toLocaleString('de-CH')`).
5. Errors keep the `#sgError` inline element (this screen's errors are
   validation-heavy and belong next to the controls) — no toast change.
6. Registration: `registerScreen('schedule', { render });`

- [ ] **Step 2: Run e2e that exercises schedule (referees spec seeds schedules)**

Run: `npx playwright test tests/e2e/referees-flows.spec.mjs`
Expected: PASS after its select updates (Task 10 does the referees
migration — if this spec still references `#sg_tournament`, update those
lines now with the same context-bar pattern).

- [ ] **Step 3: Commit**

```bash
git add admin/screens/schedule.js tests/e2e/
git commit -m "refactor: migrate schedule screen to context bar"
```

---

### Task 10: Migrate referees screen

**Files:**
- Modify: `admin/screens/referees.js`
- Modify: `tests/e2e/referees-flows.spec.mjs`

**Interfaces:**
- Consumes: `getTournamentId`, `onContextChange` is *not* needed (app.js
  re-renders the screen on context change), `dataTable`, `raw`,
  `selectOptions`, `confirmDelete`, `showToast`, `emptyState`,
  `escapeHtml`.
- Screen-local selects that stay: `#assign_category`, `#assign_match`,
  `#assign_referee`, `#assign_role_select`, `#auto_categories`,
  `#auto_roles` (the assignment section works across categories — only
  `#ref_tournament` goes away).

- [ ] **Step 1: Apply these edits**

1. Remove `#ref_tournament` from the template and its `onchange`; replace
   `currentTournamentId` init with `const currentTournamentId = getTournamentId();`
   plus a top guard `if (!currentTournamentId) { main.innerHTML = ...emptyState('Lege zuerst ein Turnier an.'); return; }`.
   `selectTournament()` becomes an `initData()` without the id parameter,
   called once at the bottom (the existing handlers-before-load order
   stays).
2. `#assign_category` is initialised from the context's tournament but
   **defaults to the context category** when present:
   after `refreshAssignCategories(currentTournamentId)`, select
   `getCategoryId()` if it appears in the list, else the first entry.
3. All four tables (Stammdaten, Zuweisungen, Auto-Preview, Workload) go
   through `dataTable` (delete buttons via `raw()`, exactly like Task 7's
   teams pattern; workload day columns map to
   `{ label: d, render: (r) => countsByReferee[r.id].byDay[d] || 0 }`).
4. Referee delete and assignment delete go through
   `confirmDelete('Schiedsrichter wirklich löschen?')` /
   `confirmDelete('Zuweisung wirklich löschen?')`; their error paths use
   `showToast(..., { type: 'error' })`.
5. Sections: wrap Stammdaten / Zuweisung / Automatische Zuteilung /
   Workload each in `<div class="panel">` with their existing `<h3>`s.
6. Registration: `registerScreen('referees', { render, context: 'tournament' });`

- [ ] **Step 2: Update `tests/e2e/referees-flows.spec.mjs`**

Replace every `page.selectOption('#ref_tournament', …)` with selecting
`#ctx_tournament` **before** clicking `button[data-screen=referees]`; add
`.modal [data-confirm]` clicks after delete-button clicks.

- [ ] **Step 3: Run e2e**

Run: `npx playwright test tests/e2e/referees-flows.spec.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add admin/screens/referees.js tests/e2e/referees-flows.spec.mjs
git commit -m "refactor: migrate referees screen to context bar with confirmations"
```

---

### Task 11: Migrate game-report screen (mobile-first scoring)

**Files:**
- Modify: `admin/screens/game-report.js`
- Modify: `tests/e2e/game-report-flows.spec.mjs`

**Interfaces:**
- Consumes: `getCategoryId`, `dataTable` (not needed — this screen keeps
  its list-free layout), `showToast`, `emptyState`, `escapeHtml`.
- Screen-local select that stays: `#gr_match`.

- [ ] **Step 1: Apply these edits**

1. Drop `#gr_tournament`/`#gr_category` and `refreshCategories`; the render
   guard/read is:

```js
const categoryId = getCategoryId();
if (!categoryId) {
  main.innerHTML = `<h2>Game Report</h2>${emptyState('Wähle oben Turnier und Kategorie.')}`;
  return;
}
```

   `refreshMatches(categoryId)` is called directly; template keeps
   `#gr_match` and `#gameReportHeader`.
2. Touch styling in `renderScoringBody`: the two `+1` buttons get
   `class="btn gr-point-btn"`, Timeout/Undo/tag buttons get
   `class="btn btn--ghost"`, the score area container keeps
   `class="gr-score"` (already styled in Task 4 with `min-height: 56px`
   and single-column stacking below 640px).
3. Wrap header + body in `<div class="panel">`.
4. Errors: keep the existing inline `#gameReportError` (scoring errors must
   appear next to the buttons the referee is tapping) — no toast switch.
5. Registration: `registerScreen('game-report', { render });`

- [ ] **Step 2: Update `tests/e2e/game-report-flows.spec.mjs`**

Every block

```js
await page.click('button[data-screen=game-report]');
await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#gr_category', { label: 'Game Report Category' });
```

becomes

```js
await page.selectOption('#ctx_tournament', { label: 'Game Report Test Tournament' });
await page.selectOption('#ctx_category', { label: 'Game Report Category' });
await page.click('button[data-screen=game-report]');
```

(6 occurrences — lines 60–62, 72–74, 92–94, 118–120, 131–133 plus the
setup block.)

- [ ] **Step 3: Run e2e**

Run: `npx playwright test tests/e2e/game-report-flows.spec.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add admin/screens/game-report.js tests/e2e/game-report-flows.spec.mjs
git commit -m "refactor: migrate game report to context bar with touch-sized scoring buttons"
```

---

### Task 12: Full suite, context-persistence assertion, escaping audit

**Files:**
- Modify: `tests/e2e/admin-flows.spec.mjs` (new assertion)
- Possibly touch: any screen file the audit flags

- [ ] **Step 1: Add a context-persistence e2e test**

Append to `tests/e2e/admin-flows.spec.mjs`:

```js
test('context selection survives screen changes', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.selectOption('#ctx_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#ctx_category', { label: 'Playwright Category' });
  await page.click('button[data-screen=teams]');
  await page.click('button[data-screen=matches]');
  await expect(page.locator('#ctx_tournament option:checked')).toHaveText('Playwright Test Tournament');
  await expect(page.locator('#ctx_category option:checked')).toHaveText('Playwright Category');
});
```

- [ ] **Step 2: Escaping audit**

Run: `grep -n 'innerHTML\|insertAdjacentHTML' admin/screens/*.js admin/ui.js admin/context.js`
For every hit, confirm each `${…}` interpolation is (a) via a `ui.js`
helper, (b) wrapped in `escapeHtml(...)`, or (c) a screen-authored literal
with no data. Fix any stragglers with `escapeHtml`.

- [ ] **Step 3: Full test run**

Run: `npm run test:unit && npx playwright test`
Expected: all green.

- [ ] **Step 4: Manual smoke checklist**

Serve root, open `/admin/` at desktop width and at 390px (devtools):
- Login card, header, context bar, scrollable pill nav.
- All 9 screens render; tables scroll horizontally at 390px.
- Game report: point buttons ≥56px tall, single column on mobile.
- Delete flows show the confirm modal; errors appear as red toasts.
- Console free of CSP violations on every screen.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/admin-flows.spec.mjs admin/
git commit -m "test: assert context persistence across screens, close escaping audit"
```
