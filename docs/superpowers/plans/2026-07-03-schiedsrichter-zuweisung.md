# Teilprojekt 4: Schiedsrichter-Zuweisung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a referee roster, manual per-match assignment with conflict
warnings, an automatic assignment generator with a fairness/eligibility
ruleset, and a workload overview to the existing Fistball EMS admin app.

**Architecture:** A new `referees` table replaces the free-text
`referee_name` on `referee_assignments` with a proper foreign key. A
`before insert or update` trigger hard-blocks double-booking a referee at
the same match time. A pure, stateless client-side function
(`admin/referee-assignment-generator.js`, mirroring
`admin/schedule-generator.js` from Teilprojekt 3) computes automatic
assignments; only the final write goes through the DB via existing
admin-only RLS. Everything lives in one new admin screen
("Schiedsrichter"), built incrementally across tasks the same way
`admin/screens/game-report.js` was in Teilprojekt 2.

**Tech Stack:** Postgres (Supabase), PL/pgSQL trigger, vanilla ES modules
(no framework/bundler), `node --test`, Playwright.

## Global Constraints

- `referee_assignments.referee_name` (free text) is replaced by
  `referee_id uuid not null references referees(id) on delete restrict` —
  safe direct replacement, production currently has **0 rows** in this
  table (verified before this plan was written), no backfill needed.
- `referees.country` is required (`not null`); `available_from`/
  `available_to` are both nullable `date` columns — `null` means available
  for the whole tournament (the common case).
- Double-booking (same `referee_id`, same `matches.scheduled_time`) is
  blocked by a DB trigger, not an RPC — there is no legitimate bypass path,
  unlike Teilprojekt 3's `finish_match`. The existing
  `admin write referee_assignments` RLS policy from Teilprojekt 1 is
  unchanged.
- The own-country soft-avoidance rule applies **only** to the role
  `"1st Referee"`, not to any other role.
- No RPC for the automatic-assignment computation — pure client-side
  function, only the final `insert` goes through the DB.
- The 5 known real roles are: `"1st Referee"`, `"2nd Referee"`,
  `"Recording Clerk"`, `"Assistant Referee 1"`, `"Assistant Referee 2"` —
  the `role` column itself stays free text (no DB enum), the UI offers
  these 5 plus a free-text "Andere" option.
- Country-conflict comparison uses `teams.name` (which holds country names
  for this real tournament) compared case-insensitively to
  `referees.country`. If a match has an unresolved KO source
  (`team_a_id`/`team_b_id` is `null`, from Teilprojekt 3), the comparison
  is simply skipped for that side — no warning, no error.
- `admin/config.js` must never be committed pointing at anything other than
  production Supabase credentials.

## File Structure

- `supabase/migrations/<ts>_referees_schema.sql` — `referees` table,
  `referee_assignments` column swap, double-booking trigger (Task 1).
- `tests/schema-referees.test.mjs` — FK/constraint/trigger/RLS tests
  (Task 1).
- `admin/db.js` — modified: `listRefereeAssignments` (Task 1),
  `listMatchesForTournament` (Task 5); added: `listReferees`,
  `createReferee`, `deleteReferee` (Task 2), `listAssignmentsForMatch`,
  `createRefereeAssignment`, `deleteRefereeAssignment` (Task 3),
  `listAssignmentsForMatchIds`, `createRefereeAssignments` (Task 5).
- `admin/screens/game-report.js` — modified: referee display now reads
  `referee.name` via join instead of the removed `referee_name` (Task 1).
- `admin/screens/referees.js` — new "Schiedsrichter" screen, built
  incrementally: roster CRUD (Task 2), manual assignment (Task 3),
  automatic assignment (Task 5), workload overview (Task 6).
- `admin/referee-assignment-generator.js` — pure function `assignReferees`
  (Task 4).
- `admin/referee-assignment-generator.test.mjs` — unit tests (Task 4).
- `admin/app.js`, `admin/index.html` — nav entry + script tag (Task 2).
- `tests/e2e/referees-flows.spec.mjs` — new e2e test file, appended to
  across Tasks 2, 3, 5, 6.
- `package.json` — `test:rls` gains `tests/schema-referees.test.mjs`
  (Task 1); `test:unit` gains `admin/referee-assignment-generator.test.mjs`
  (Task 4).

---

### Task 1: Schema — `referees` table, column swap, double-booking trigger

**Files:**
- Create: `supabase/migrations/<ts>_referees_schema.sql`
- Test: `tests/schema-referees.test.mjs`
- Modify: `admin/db.js` (`listRefereeAssignments`)
- Modify: `admin/screens/game-report.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `matches.scheduled_time`, `tournaments`, `teams` from
  Teilprojekt 1.
- Produces: `referees` table (`id`, `tournament_id`, `name`, `country`,
  `available_from`, `available_to`), `referee_assignments.referee_id` —
  every later task in this plan depends on both.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new referees_schema`

- [ ] **Step 2: Write the schema and trigger**

Put this in `supabase/migrations/<ts>_referees_schema.sql`:

```sql
create table referees (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  country text not null,
  available_from date,
  available_to date,
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);

grant select, insert, update, delete on public.referees to service_role;

alter table referee_assignments drop column referee_name;
alter table referee_assignments add column referee_id uuid not null references referees(id) on delete restrict;

alter table referees enable row level security;

create policy "public read referees" on referees for select using (true);
create policy "admin write referees" on referees for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

create or replace function public.prevent_double_booked_referee() returns trigger
language plpgsql as $$
declare
  v_scheduled_time timestamptz;
  v_conflict_count integer;
begin
  select scheduled_time into v_scheduled_time from matches where id = new.match_id;
  if v_scheduled_time is null then
    return new;
  end if;

  select count(*) into v_conflict_count
  from referee_assignments ra
  join matches m on m.id = ra.match_id
  where ra.referee_id = new.referee_id
    and ra.id is distinct from new.id
    and m.scheduled_time = v_scheduled_time;

  if v_conflict_count > 0 then
    raise exception 'referee is already assigned to a match at this time (possibly this same match)';
  end if;

  return new;
end;
$$;

create trigger referee_assignments_prevent_double_booking
  before insert or update on referee_assignments
  for each row execute function public.prevent_double_booked_referee();
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Fix the now-broken referee display**

`admin/db.js`'s `listRefereeAssignments` currently selects the now-removed
`referee_name` column. Replace it:

```js
export async function listRefereeAssignments(matchId) {
  const { data, error } = await getClient()
    .from('referee_assignments')
    .select('role, referee:referee_id(name)')
    .eq('match_id', matchId);
  if (error) throw error;
  return data;
}
```

In `admin/screens/game-report.js`, find this line (inside the function that
builds `refereeList`):

```js
    ? referees.map((r) => `${escapeHtml(r.role)}: ${escapeHtml(r.referee_name)}`).join(', ')
```

Replace it with:

```js
    ? referees.map((r) => `${escapeHtml(r.role)}: ${escapeHtml(r.referee.name)}`).join(', ')
```

- [ ] **Step 5: Write the failing tests**

Create `tests/schema-referees.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;
for (const [k, v] of Object.entries({ url, anonKey, serviceKey, adminPassword, scorerPassword })) {
  if (!v) throw new Error(`Missing env var for ${k} — see .env.example`);
}

const service = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, refereeAId, refereeBId, matchAId, matchBId, admin, scorer;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Referees Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Referees Schema Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Referees Schema Team A' },
    { category_id: categoryId, name: 'Referees Schema Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const referees = await service.from('referees').insert([
    { tournament_id: tournamentId, name: 'Referees Schema Ref A', country: 'Switzerland' },
    { tournament_id: tournamentId, name: 'Referees Schema Ref B', country: 'Austria' },
  ]).select();
  refereeAId = referees.data[0].id;
  refereeBId = referees.data[1].id;
  const matches = await service.from('matches').insert([
    { category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999600, scheduled_time: '2026-07-23T10:00:00Z' },
    { category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999601, scheduled_time: '2026-07-23T13:00:00Z' },
  ]).select();
  matchAId = matches.data[0].id;
  matchBId = matches.data[1].id;

  admin = createClient(url, anonKey);
  await admin.auth.signInWithPassword({ email: 'admin@fistball-ems.local', password: adminPassword });
  scorer = createClient(url, anonKey);
  await scorer.auth.signInWithPassword({ email: 'scorer@fistball-ems.local', password: scorerPassword });
});

after(async () => {
  await service.from('referee_assignments').delete().in('match_id', [matchAId, matchBId]);
  await service.from('matches').delete().in('id', [matchAId, matchBId]);
  await service.from('referees').delete().in('id', [refereeAId, refereeBId]);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

test('unique(tournament_id, name) is enforced on referees', async () => {
  const { error } = await service.from('referees').insert({
    tournament_id: tournamentId, name: 'Referees Schema Ref A', country: 'Germany',
  });
  assert.ok(error, 'expected a unique constraint violation');
});

test('referee_assignments requires a valid referee_id (FK enforced)', async () => {
  const { error } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: '00000000-0000-0000-0000-000000000000', role: '1st Referee',
  });
  assert.ok(error, 'expected a foreign key violation error');
});

test('deleting a referenced referee is blocked (on delete restrict)', async () => {
  const { data: a } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();
  const { error } = await service.from('referees').delete().eq('id', refereeAId);
  assert.ok(error, 'expected a foreign key violation error');
  await service.from('referee_assignments').delete().eq('id', a.id);
});

test('the double-booking trigger blocks a second assignment at the same scheduled_time', async () => {
  const { data: first, error: firstError } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();
  assert.equal(firstError, null);

  const { error: secondError } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '2nd Referee',
  });
  assert.ok(secondError, 'expected the trigger to reject a second assignment of the same referee to the same match');

  await service.from('referee_assignments').delete().eq('id', first.id);
});

test('the double-booking trigger allows the same referee at a different scheduled_time', async () => {
  const { data: first } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();

  const { data: second, error } = await service.from('referee_assignments').insert({
    match_id: matchBId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();
  assert.equal(error, null);

  await service.from('referee_assignments').delete().in('id', [first.id, second.id]);
});

test('scorer cannot write to referees or referee_assignments', async () => {
  const { error: refError } = await scorer.from('referees').insert({
    tournament_id: tournamentId, name: 'Should Fail', country: 'Nowhere',
  });
  assert.ok(refError, 'expected scorer to be rejected writing referees');

  const { error: assignError } = await scorer.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeBId, role: '1st Referee',
  });
  assert.ok(assignError, 'expected scorer to be rejected writing referee_assignments');
});

test('admin can create and read a referee', async () => {
  const { data, error } = await admin.from('referees').select().eq('id', refereeBId).single();
  assert.equal(error, null);
  assert.equal(data.country, 'Austria');
});
```

- [ ] **Step 6: Run the tests**

Run: `set -a && source .env && set +a && node --test tests/schema-referees.test.mjs`
Expected: `# pass 7`.

- [ ] **Step 7: Wire into `test:rls`**

In `package.json`, change:

```json
"test:rls": "node --test tests/rls.test.mjs tests/migrate-sheet-data.test.mjs tests/schema.test.mjs tests/schema-sumula.test.mjs tests/game-report-rls.test.mjs tests/game-report-rpc.test.mjs tests/schema-spielplan.test.mjs tests/finish-match-rpc.test.mjs",
```

to:

```json
"test:rls": "node --test tests/rls.test.mjs tests/migrate-sheet-data.test.mjs tests/schema.test.mjs tests/schema-sumula.test.mjs tests/game-report-rls.test.mjs tests/game-report-rpc.test.mjs tests/schema-spielplan.test.mjs tests/finish-match-rpc.test.mjs tests/schema-referees.test.mjs",
```

- [ ] **Step 8: Verify Game Report still works**

Run: `node scripts/generate-admin-config.mjs && set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs`
Expected: all existing Game Report e2e tests still pass (confirms the
`referee.name` fix in Step 4 didn't break the header display).

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations tests/schema-referees.test.mjs admin/db.js admin/screens/game-report.js package.json
git commit -m "feat: add referees table, replace referee_name with referee_id, add double-booking trigger"
```

---

### Task 2: Referee roster screen (Stammdaten)

**Files:**
- Modify: `admin/db.js` (append `listReferees`, `createReferee`, `deleteReferee`)
- Create: `admin/screens/referees.js`
- Modify: `admin/app.js` (nav entry)
- Modify: `admin/index.html` (script tag)
- Create: `tests/e2e/referees-flows.spec.mjs`

**Interfaces:**
- Consumes: `listTournaments`, `escapeHtml` from `admin/db.js`
  (Teilprojekt 1). Consumes `referees` table from Task 1.
- Produces: `listReferees(tournamentId)`, `createReferee({tournament_id,
  name, country, available_from, available_to})`, `deleteReferee(id)` in
  `admin/db.js` — Task 3 and Task 5 both reuse `listReferees`. The
  `referees` screen registered under the key `'referees'` — Tasks 3, 5, 6
  extend its `render` function.

- [ ] **Step 1: Append the new `admin/db.js` functions**

```js
export async function listReferees(tournamentId) {
  const { data, error } = await getClient().from('referees').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createReferee({ tournament_id, name, country, available_from, available_to }) {
  const { error } = await getClient().from('referees').insert({
    tournament_id, name, country,
    available_from: available_from || null,
    available_to: available_to || null,
  });
  if (error) throw error;
}

export async function deleteReferee(id) {
  const { error } = await getClient().from('referees').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Create the screen**

Create `admin/screens/referees.js`:

```js
import { registerScreen } from '../app.js';
import { listTournaments, listReferees, createReferee, deleteReferee, escapeHtml } from '../db.js';

async function render(main, { role }) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Schiedsrichter</h2>
    <label>Turnier<select id="ref_tournament">${tOptions}</select></label>

    <h3>Stammdaten</h3>
    <div id="refTableWrap"></div>
    <form id="refForm" class="entity-form">
      <label>Name<input id="ref_name" required></label>
      <label>Land<input id="ref_country" required></label>
      <label>Verfügbar von<input id="ref_available_from" type="date"></label>
      <label>Verfügbar bis<input id="ref_available_to" type="date"></label>
      <button type="submit">Anlegen</button>
      <p id="refError" class="error" hidden></p>
    </form>
  `;

  let currentTournamentId = null;

  async function renderRefTable() {
    const referees = currentTournamentId ? await listReferees(currentTournamentId) : [];
    document.getElementById('refTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Land</th><th>Verfügbar</th><th></th></tr></thead>
        <tbody>${referees.map((r) => `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.country)}</td>
            <td>${r.available_from || r.available_to ? `${escapeHtml(r.available_from ?? '…')} – ${escapeHtml(r.available_to ?? '…')}` : 'ganzes Turnier'}</td>
            <td><button data-delete-ref="${r.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete-ref]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('refError');
        try {
          await deleteReferee(btn.dataset.deleteRef);
          await renderRefTable();
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Zuweisungen verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    await renderRefTable();
  }

  document.getElementById('ref_tournament').onchange = (e) => selectTournament(e.target.value);
  if (tournaments[0]) await selectTournament(tournaments[0].id);

  document.getElementById('refForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('refError');
    try {
      await createReferee({
        tournament_id: currentTournamentId,
        name: document.getElementById('ref_name').value.trim(),
        country: document.getElementById('ref_country').value.trim(),
        available_from: document.getElementById('ref_available_from').value,
        available_to: document.getElementById('ref_available_to').value,
      });
      document.getElementById('ref_name').value = '';
      document.getElementById('ref_country').value = '';
      await renderRefTable();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('referees', { render });
```

- [ ] **Step 3: Wire up the nav entry**

In `admin/app.js`, change the `items` array in `renderNav`:

```js
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
```

- [ ] **Step 4: Add the script tag**

In `admin/index.html`, add after the `schedule.js` script tag:

```html
  <script type="module" src="screens/referees.js"></script>
```

- [ ] **Step 5: Write the failing e2e test**

Create `tests/e2e/referees-flows.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@fistball-ems.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function loginAs(page, email, password) {
  await page.goto('/');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#loginForm button[type=submit]');
  await expect(page.locator('#appView')).toBeVisible();
}

test('admin can create and delete a referee', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Test Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Referees Test Tournament');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Test Tournament' });
  await page.fill('#ref_name', 'Jane Referee');
  await page.fill('#ref_country', 'Switzerland');
  await page.click('#refForm button[type=submit]');
  await expect(page.locator('#refTableWrap table tbody')).toContainText('Jane Referee');
  await expect(page.locator('#refTableWrap table tbody')).toContainText('Switzerland');

  await page.click('[data-delete-ref]');
  await expect(page.locator('#refTableWrap table tbody')).not.toContainText('Jane Referee');
});
```

- [ ] **Step 6: Run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/referees-flows.spec.mjs`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 7: Commit**

```bash
git add admin/db.js admin/screens/referees.js admin/app.js admin/index.html tests/e2e/referees-flows.spec.mjs
git commit -m "feat: add referee roster screen"
```

---

### Task 3: Manual per-match assignment with conflict warning

**Files:**
- Modify: `admin/db.js` (append `listAssignmentsForMatch`,
  `createRefereeAssignment`, `deleteRefereeAssignment`)
- Modify: `admin/screens/referees.js`
- Modify: `tests/e2e/referees-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `listCategories`, `listMatches` (already returns
  `team_a:{name}`, `team_b:{name}`) from `admin/db.js`. Consumes
  `listReferees` from Task 2.
- Produces: `listAssignmentsForMatch(matchId): Promise<Array<{id, role,
  referee: {id, name, country}}>>`, `createRefereeAssignment({match_id,
  referee_id, role})`, `deleteRefereeAssignment(id)` in `admin/db.js`.

- [ ] **Step 1: Append the new `admin/db.js` functions**

```js
export async function listAssignmentsForMatch(matchId) {
  const { data, error } = await getClient()
    .from('referee_assignments')
    .select('id, role, referee:referee_id(id, name, country)')
    .eq('match_id', matchId);
  if (error) throw error;
  return data;
}

export async function createRefereeAssignment({ match_id, referee_id, role }) {
  const { error } = await getClient().from('referee_assignments').insert({ match_id, referee_id, role });
  if (error) throw error;
}

export async function deleteRefereeAssignment(id) {
  const { error } = await getClient().from('referee_assignments').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Extend `admin/screens/referees.js`**

Update the import line:

```js
import {
  listTournaments, listCategories, listMatches, listReferees, createReferee, deleteReferee,
  listAssignmentsForMatch, createRefereeAssignment, deleteRefereeAssignment, escapeHtml,
} from '../db.js';
```

Add a `KNOWN_ROLES` constant right after the imports:

```js
const KNOWN_ROLES = ['1st Referee', '2nd Referee', 'Recording Clerk', 'Assistant Referee 1', 'Assistant Referee 2'];
```

Add this markup right after the closing `</form>` of `refForm` (still inside
the same template literal, before the closing backtick):

```html
    <h3>Zuweisung</h3>
    <label>Kategorie<select id="assign_category"></select></label>
    <label>Match<select id="assign_match"></select></label>
    <div id="assignmentsWrap"></div>
    <form id="assignForm" class="entity-form">
      <label>Schiedsrichter<select id="assign_referee"></select></label>
      <label>Rolle
        <select id="assign_role_select">
          ${KNOWN_ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}
          <option value="other">Andere…</option>
        </select>
      </label>
      <label id="assign_role_custom_label" hidden>Rolle (Freitext)<input id="assign_role_custom"></label>
      <p id="assignConflictWarning" class="warning" hidden></p>
      <button type="submit">Zuweisen</button>
      <p id="assignError" class="error" hidden></p>
    </form>
```

Add this state and logic at the end of `render`, after the existing
`refForm` submit handler (still inside `render`, before its closing brace):

```js
  let currentCategoryId = null;
  let currentMatchId = null;
  let currentMatches = [];
  let currentReferees = [];

  async function refreshAssignCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('assign_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshAssignMatches(categoryId) {
    currentMatches = await listMatches(categoryId);
    document.getElementById('assign_match').innerHTML =
      currentMatches.map((m) => `<option value="${m.id}">${escapeHtml(m.round_label || '—')} (${escapeHtml(m.team_a?.name ?? '?')} vs ${escapeHtml(m.team_b?.name ?? '?')})</option>`).join('');
  }

  async function refreshAssignReferees() {
    currentReferees = currentTournamentId ? await listReferees(currentTournamentId) : [];
    document.getElementById('assign_referee').innerHTML =
      currentReferees.map((r) => `<option value="${r.id}">${escapeHtml(r.name)} (${escapeHtml(r.country)})</option>`).join('');
  }

  async function renderAssignments() {
    const assignments = currentMatchId ? await listAssignmentsForMatch(currentMatchId) : [];
    document.getElementById('assignmentsWrap').innerHTML = `
      <table>
        <thead><tr><th>Rolle</th><th>Schiedsrichter</th><th>Land</th><th></th></tr></thead>
        <tbody>${assignments.map((a) => `
          <tr>
            <td>${escapeHtml(a.role)}</td>
            <td>${escapeHtml(a.referee.name)}</td>
            <td>${escapeHtml(a.referee.country)}</td>
            <td><button data-delete-assignment="${a.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete-assignment]').forEach((btn) => {
      btn.onclick = async () => {
        await deleteRefereeAssignment(btn.dataset.deleteAssignment);
        await renderAssignments();
      };
    });
  }

  async function selectCategoryForAssignment(categoryId) {
    currentCategoryId = categoryId;
    await refreshAssignMatches(categoryId);
    const firstMatch = currentMatches[0];
    currentMatchId = firstMatch ? firstMatch.id : null;
    await renderAssignments();
    updateConflictWarning();
  }

  document.getElementById('assign_category').onchange = (e) => selectCategoryForAssignment(e.target.value);
  document.getElementById('assign_match').onchange = (e) => {
    currentMatchId = e.target.value;
    renderAssignments();
    updateConflictWarning();
  };
  document.getElementById('assign_referee').onchange = updateConflictWarning;

  function updateConflictWarning() {
    const warningEl = document.getElementById('assignConflictWarning');
    const match = currentMatches.find((m) => m.id === currentMatchId);
    const referee = currentReferees.find((r) => r.id === document.getElementById('assign_referee').value);
    if (!match || !referee) {
      warningEl.hidden = true;
      return;
    }
    const teamAName = match.team_a?.name?.toLowerCase();
    const teamBName = match.team_b?.name?.toLowerCase();
    const refCountry = referee.country.toLowerCase();
    if (teamAName === refCountry || teamBName === refCountry) {
      warningEl.textContent = `Achtung: ${referee.name} (${referee.country}) pfeift ggf. ein Spiel des eigenen Landes.`;
      warningEl.hidden = false;
    } else {
      warningEl.hidden = true;
    }
  }

  document.getElementById('assign_role_select').onchange = (e) => {
    document.getElementById('assign_role_custom_label').hidden = e.target.value !== 'other';
  };

  await refreshAssignReferees();
  if (currentTournamentId) {
    const categories = await refreshAssignCategories(currentTournamentId);
    if (categories[0]) await selectCategoryForAssignment(categories[0].id);
  }

  document.getElementById('assignForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('assignError');
    try {
      const roleSelect = document.getElementById('assign_role_select').value;
      const role = roleSelect === 'other' ? document.getElementById('assign_role_custom').value.trim() : roleSelect;
      await createRefereeAssignment({
        match_id: currentMatchId,
        referee_id: document.getElementById('assign_referee').value,
        role,
      });
      await renderAssignments();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
```

Update `refForm`'s submit handler (defined in Task 2) so a newly created
referee is immediately selectable in the assignment dropdown, instead of
only appearing after the next tournament reselect. Change:

```js
      document.getElementById('ref_name').value = '';
      document.getElementById('ref_country').value = '';
      await renderRefTable();
```

to:

```js
      document.getElementById('ref_name').value = '';
      document.getElementById('ref_country').value = '';
      await renderRefTable();
      await refreshAssignReferees();
```

Update `selectTournament` (defined in Task 2) to also refresh the
assignment section's category list and referee dropdown:

```js
  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    await renderRefTable();
    await refreshAssignReferees();
    const categories = await refreshAssignCategories(tournamentId);
    if (categories[0]) await selectCategoryForAssignment(categories[0].id);
  }
```

(This replaces the simpler Task 2 version of `selectTournament` — since
`refreshAssignReferees`/`refreshAssignCategories`/`selectCategoryForAssignment`
are defined further down in the same `render` function via function
declarations, they're hoisted and available here regardless of source
order.)

Add this CSS rule to `admin/styles.css` for the new warning style (find the
existing `.error` rule and add a sibling rule right after it):

```css
.warning { color: #b45309; }
```

- [ ] **Step 3: Write the failing e2e test**

Append to `tests/e2e/referees-flows.spec.mjs`:

```js
test('admin can manually assign a referee to a match and sees a same-country warning', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Assign Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Referees Assign Tournament' });
  await page.fill('#c_name', 'Referees Assign Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Referees Assign Tournament' });
  await page.selectOption('#team_category', { label: 'Referees Assign Category' });
  for (const name of ['Switzerland', 'Austria']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Referees Assign Tournament' });
  await page.selectOption('#match_category', { label: 'Referees Assign Category' });
  await page.selectOption('#match_team_a', { label: 'Switzerland' });
  await page.selectOption('#match_team_b', { label: 'Austria' });
  await page.fill('#match_round', 'Group Match 1');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Group Match 1');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Assign Tournament' });
  await page.fill('#ref_name', 'Swiss Ref');
  await page.fill('#ref_country', 'Switzerland');
  await page.click('#refForm button[type=submit]');
  await expect(page.locator('#refTableWrap table tbody')).toContainText('Swiss Ref');

  await page.selectOption('#assign_category', { label: 'Referees Assign Category' });
  await page.selectOption('#assign_match', { label: /Group Match 1/ });
  await page.selectOption('#assign_referee', { label: 'Swiss Ref (Switzerland)' });
  await expect(page.locator('#assignConflictWarning')).toBeVisible();
  await expect(page.locator('#assignConflictWarning')).toContainText('Swiss Ref');

  await page.selectOption('#assign_role_select', '1st Referee');
  await page.click('#assignForm button[type=submit]');
  await expect(page.locator('#assignmentsWrap table tbody')).toContainText('Swiss Ref');
  await expect(page.locator('#assignmentsWrap table tbody')).toContainText('1st Referee');
});
```

- [ ] **Step 4: Run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/referees-flows.spec.mjs -g "manually assign"`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 5: Commit**

```bash
git add admin/db.js admin/screens/referees.js admin/styles.css tests/e2e/referees-flows.spec.mjs
git commit -m "feat: add manual referee assignment with same-country warning"
```

---

### Task 4: Automatic assignment (pure function)

**Files:**
- Create: `admin/referee-assignment-generator.js`
- Create: `admin/referee-assignment-generator.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (pure function, no imports).
- Produces: `assignReferees({ matches, referees, existingAssignments,
  roles }): Array<{matchId, role, refereeId: string | null}>` — Task 5's
  screen calls this.
  - `matches`: `Array<{id, scheduled_time: string | null, team_a_name:
    string | null, team_b_name: string | null}>`
  - `referees`: `Array<{id, country, available_from: string | null,
    available_to: string | null}>` (`available_from`/`available_to` as
    `YYYY-MM-DD` strings)
  - `existingAssignments`: `Array<{referee_id, match_id, role}>`
  - `roles`: `Array<string>` — roles to fill on every match that doesn't
    already have them

- [ ] **Step 1: Write the failing tests**

Create `admin/referee-assignment-generator.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignReferees } from './referee-assignment-generator.js';

function match(id, time, teamA, teamB) {
  return { id, scheduled_time: time, team_a_name: teamA, team_b_name: teamB };
}
function referee(id, country, from = null, to = null) {
  return { id, country, available_from: from, available_to: to };
}

test('distributes assignments evenly across referees when nothing else constrains them', () => {
  const matches = [
    match('m1', '2026-07-23T09:00:00Z', 'A', 'B'),
    match('m2', '2026-07-23T10:00:00Z', 'A', 'B'),
    match('m3', '2026-07-23T11:00:00Z', 'A', 'B'),
    match('m4', '2026-07-23T12:00:00Z', 'A', 'B'),
  ];
  const referees = [referee('r1', 'Switzerland'), referee('r2', 'Austria')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['Recording Clerk'] });
  const counts = { r1: 0, r2: 0 };
  for (const r of result) counts[r.refereeId]++;
  assert.equal(counts.r1, 2);
  assert.equal(counts.r2, 2);
});

test('avoids assigning a referee to a 1st Referee slot for their own country when an alternative exists', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'Switzerland', 'Austria')];
  const referees = [referee('r1', 'Switzerland'), referee('r2', 'Germany')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['1st Referee'] });
  assert.equal(result[0].refereeId, 'r2');
});

test('still assigns the own-country referee to 1st Referee when no alternative exists (soft rule)', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'Switzerland', 'Austria')];
  const referees = [referee('r1', 'Switzerland')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['1st Referee'] });
  assert.equal(result[0].refereeId, 'r1');
});

test('respects available_from/available_to and picks an available referee instead', () => {
  const matches = [match('m1', '2026-07-24T09:00:00Z', 'A', 'B')];
  const referees = [
    referee('r1', 'Switzerland', '2026-07-23', '2026-07-23'),
    referee('r2', 'Austria', '2026-07-24', '2026-07-26'),
  ];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['Recording Clerk'] });
  assert.equal(result[0].refereeId, 'r2');
});

test('never double-books a referee at the same scheduled_time even within one run', () => {
  const matches = [
    match('m1', '2026-07-23T09:00:00Z', 'A', 'B'),
    match('m2', '2026-07-23T09:00:00Z', 'C', 'D'),
  ];
  const referees = [referee('r1', 'Switzerland')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['Recording Clerk'] });
  const filled = result.filter((r) => r.refereeId !== null);
  assert.equal(filled.length, 1);
  const empty = result.find((r) => r.refereeId === null);
  assert.ok(empty);
});

test('never assigns the same referee to two roles in the same match', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'A', 'B')];
  const referees = [referee('r1', 'Switzerland')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['1st Referee', '2nd Referee'] });
  assert.equal(result[0].refereeId, 'r1');
  assert.equal(result[1].refereeId, null);
});

test('returns a null refereeId for a slot with zero referees available', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'A', 'B')];
  const result = assignReferees({ matches, referees: [], existingAssignments: [], roles: ['Recording Clerk'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].refereeId, null);
});

test('prefers a referee who was not assigned the immediately preceding time slot (rest rule)', () => {
  const matches = [
    match('m0', '2026-07-23T08:00:00Z', 'X', 'Y'),
    match('m1', '2026-07-23T09:00:00Z', 'A', 'B'),
    match('m2', '2026-07-23T10:00:00Z', 'C', 'D'),
  ];
  const referees = [referee('r1', 'Switzerland'), referee('r2', 'Austria')];
  // Both referees already have exactly 1 assignment each (tied count), so the
  // count tie-breaker alone would not distinguish them — isolates the rest
  // rule as the deciding factor. r1's existing assignment is at m1, the slot
  // immediately before m2; r2's is at m0, two slots before m2.
  const existingAssignments = [
    { referee_id: 'r1', match_id: 'm1', role: 'Recording Clerk' },
    { referee_id: 'r2', match_id: 'm0', role: 'Recording Clerk' },
  ];
  const result = assignReferees({ matches, referees, existingAssignments, roles: ['Recording Clerk'] });
  // m0 and m1 already have 'Recording Clerk' filled via existingAssignments,
  // so only m2 produces a result row.
  assert.equal(result.length, 1);
  assert.equal(result[0].matchId, 'm2');
  assert.equal(result[0].refereeId, 'r2');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test admin/referee-assignment-generator.test.mjs`
Expected: FAIL — `referee-assignment-generator.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `admin/referee-assignment-generator.js`:

```js
export function assignReferees({ matches, referees, existingAssignments, roles }) {
  const countAssignments = new Map();
  for (const r of referees) countAssignments.set(r.id, 0);
  for (const a of existingAssignments) {
    countAssignments.set(a.referee_id, (countAssignments.get(a.referee_id) || 0) + 1);
  }

  const matchesById = new Map(matches.map((m) => [m.id, m]));

  const assignedAtTime = new Set();
  for (const a of existingAssignments) {
    const m = matchesById.get(a.match_id);
    if (m && m.scheduled_time) assignedAtTime.add(`${a.referee_id}|${m.scheduled_time}`);
  }

  const inMatch = new Map();
  for (const a of existingAssignments) {
    if (!inMatch.has(a.match_id)) inMatch.set(a.match_id, { roles: new Set(), refereeIds: new Set() });
    inMatch.get(a.match_id).roles.add(a.role);
    inMatch.get(a.match_id).refereeIds.add(a.referee_id);
  }

  const sortedMatches = [...matches].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
  const uniqueTimes = [...new Set(sortedMatches.filter((m) => m.scheduled_time).map((m) => m.scheduled_time))].sort();
  const timeIndex = new Map(uniqueTimes.map((t, i) => [t, i]));

  const lastSlotByReferee = new Map();
  for (const a of existingAssignments) {
    const m = matchesById.get(a.match_id);
    if (m && m.scheduled_time && timeIndex.has(m.scheduled_time)) {
      if (!lastSlotByReferee.has(a.referee_id)) lastSlotByReferee.set(a.referee_id, new Set());
      lastSlotByReferee.get(a.referee_id).add(timeIndex.get(m.scheduled_time));
    }
  }

  const results = [];

  for (const match of sortedMatches) {
    const matchState = inMatch.get(match.id) || { roles: new Set(), refereeIds: new Set() };
    inMatch.set(match.id, matchState);

    for (const role of roles) {
      if (matchState.roles.has(role)) continue;

      let best = null;
      let bestScore = Infinity;
      let bestCount = Infinity;

      for (const ref of referees) {
        if (matchState.refereeIds.has(ref.id)) continue;
        if (match.scheduled_time && assignedAtTime.has(`${ref.id}|${match.scheduled_time}`)) continue;
        const matchDate = match.scheduled_time ? match.scheduled_time.slice(0, 10) : null;
        if (matchDate && ref.available_from && matchDate < ref.available_from) continue;
        if (matchDate && ref.available_to && matchDate > ref.available_to) continue;

        let score = 0;
        if (role === '1st Referee') {
          const refCountry = ref.country.toLowerCase();
          const conflict =
            (match.team_a_name && match.team_a_name.toLowerCase() === refCountry) ||
            (match.team_b_name && match.team_b_name.toLowerCase() === refCountry);
          if (conflict) score += 100;
        }
        if (match.scheduled_time && timeIndex.has(match.scheduled_time)) {
          const idx = timeIndex.get(match.scheduled_time);
          if (lastSlotByReferee.has(ref.id) && lastSlotByReferee.get(ref.id).has(idx - 1)) score += 10;
        }

        const count = countAssignments.get(ref.id) || 0;
        if (score < bestScore || (score === bestScore && count < bestCount)) {
          best = ref;
          bestScore = score;
          bestCount = count;
        }
      }

      if (best) {
        results.push({ matchId: match.id, role, refereeId: best.id });
        matchState.roles.add(role);
        matchState.refereeIds.add(best.id);
        countAssignments.set(best.id, (countAssignments.get(best.id) || 0) + 1);
        if (match.scheduled_time) {
          assignedAtTime.add(`${best.id}|${match.scheduled_time}`);
          if (timeIndex.has(match.scheduled_time)) {
            if (!lastSlotByReferee.has(best.id)) lastSlotByReferee.set(best.id, new Set());
            lastSlotByReferee.get(best.id).add(timeIndex.get(match.scheduled_time));
          }
        }
      } else {
        results.push({ matchId: match.id, role, refereeId: null });
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test admin/referee-assignment-generator.test.mjs`
Expected: `# pass 8`.

- [ ] **Step 5: Wire into `test:unit`**

In `package.json`, change:

```json
"test:unit": "node --test scripts/__tests__/*.test.mjs admin/schedule-generator.test.mjs",
```

to:

```json
"test:unit": "node --test scripts/__tests__/*.test.mjs admin/schedule-generator.test.mjs admin/referee-assignment-generator.test.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add admin/referee-assignment-generator.js admin/referee-assignment-generator.test.mjs package.json
git commit -m "feat: add pure automatic referee assignment function"
```

---

### Task 5: Automatic assignment UI

**Files:**
- Modify: `admin/db.js` (extend `listMatchesForTournament`; append
  `listAssignmentsForMatchIds`, `createRefereeAssignments`)
- Modify: `admin/screens/referees.js`
- Modify: `tests/e2e/referees-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `assignReferees` from Task 4. Consumes `listCategories`,
  `listReferees` from earlier tasks.
- Produces: `listAssignmentsForMatchIds(matchIds): Promise<Array<{referee_id,
  match_id, role}>>`, `createRefereeAssignments(rows): Promise<void>` in
  `admin/db.js`. Extended `listMatchesForTournament` return shape (adds
  `team_a`/`team_b` name joins) — Task 6 also relies on this extended
  shape.

- [ ] **Step 1: Update `admin/db.js`**

Replace the existing `listMatchesForTournament` function (from Teilprojekt
3) to also join team names:

```js
export async function listMatchesForTournament(tournamentId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, category_id, team_a_id, team_b_id, court_id, scheduled_time, team_a:team_a_id(name), team_b:team_b_id(name), categories!inner(tournament_id)')
    .eq('categories.tournament_id', tournamentId);
  if (error) throw error;
  return data;
}
```

Append these two functions:

```js
export async function listAssignmentsForMatchIds(matchIds) {
  if (matchIds.length === 0) return [];
  const { data, error } = await getClient()
    .from('referee_assignments')
    .select('referee_id, match_id, role')
    .in('match_id', matchIds);
  if (error) throw error;
  return data;
}

export async function createRefereeAssignments(rows) {
  const { error } = await getClient().from('referee_assignments').insert(rows);
  if (error) throw error;
}
```

- [ ] **Step 2: Extend `admin/screens/referees.js`**

Update the import line:

```js
import {
  listTournaments, listCategories, listMatches, listMatchesForTournament, listReferees, createReferee, deleteReferee,
  listAssignmentsForMatch, createRefereeAssignment, deleteRefereeAssignment,
  listAssignmentsForMatchIds, createRefereeAssignments, escapeHtml,
} from '../db.js';
import { assignReferees } from '../referee-assignment-generator.js';
```

Add this markup after the `assignForm`'s closing `</form>` (still inside
the top-level template literal):

```html
    <h3>Automatische Zuteilung</h3>
    <fieldset id="auto_categories"><legend>Kategorien</legend></fieldset>
    <fieldset id="auto_roles"><legend>Rollen</legend>
      ${KNOWN_ROLES.map((r) => `<label><input type="checkbox" value="${r}" checked> ${r}</label>`).join('')}
    </fieldset>
    <button id="auto_preview">Vorschau berechnen</button>
    <p id="autoError" class="error" hidden></p>
    <div id="auto_preview_wrap"></div>
```

Add this logic at the end of `render`, after the `assignForm` submit
handler:

```js
  async function refreshAutoCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('auto_categories').innerHTML = '<legend>Kategorien</legend>' + categories.map((c) =>
      `<label><input type="checkbox" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
  }

  let autoPreviewResults = null;

  document.getElementById('auto_preview').onclick = async () => {
    const errorEl = document.getElementById('autoError');
    errorEl.hidden = true;
    autoPreviewResults = null;
    document.getElementById('auto_preview_wrap').innerHTML = '';
    try {
      const categoryIds = [...document.querySelectorAll('#auto_categories input:checked')].map((el) => el.value);
      const roles = [...document.querySelectorAll('#auto_roles input:checked')].map((el) => el.value);
      if (categoryIds.length === 0) throw new Error('Mindestens eine Kategorie auswählen.');
      if (roles.length === 0) throw new Error('Mindestens eine Rolle auswählen.');

      const [allTournamentMatches, referees] = await Promise.all([
        listMatchesForTournament(currentTournamentId),
        listReferees(currentTournamentId),
      ]);
      const matches = allTournamentMatches
        .filter((m) => categoryIds.includes(m.category_id))
        .map((m) => ({
          id: m.id,
          scheduled_time: m.scheduled_time,
          team_a_name: m.team_a?.name ?? null,
          team_b_name: m.team_b?.name ?? null,
        }));
      const matchIds = allTournamentMatches.map((m) => m.id);
      const existingAssignments = await listAssignmentsForMatchIds(matchIds);

      const results = assignReferees({ matches, referees, existingAssignments, roles });
      autoPreviewResults = results;

      const matchLabel = Object.fromEntries(matches.map((m) => [m.id, `${escapeHtml(m.team_a_name ?? '?')} vs ${escapeHtml(m.team_b_name ?? '?')}`]));
      const refereeName = Object.fromEntries(referees.map((r) => [r.id, r.name]));

      const unresolvedCount = results.filter((r) => r.refereeId === null).length;

      document.getElementById('auto_preview_wrap').innerHTML = `
        ${unresolvedCount > 0 ? `<p class="warning">${unresolvedCount} Rolle(n) konnten nicht zugeteilt werden.</p>` : ''}
        <table>
          <thead><tr><th>Match</th><th>Rolle</th><th>Schiedsrichter</th></tr></thead>
          <tbody>${results.map((r) => `
            <tr>
              <td>${matchLabel[r.matchId]}</td>
              <td>${escapeHtml(r.role)}</td>
              <td>${r.refereeId ? escapeHtml(refereeName[r.refereeId]) : '— nicht zuteilbar —'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <button id="auto_commit">Anlegen</button>
      `;

      document.getElementById('auto_commit').onclick = async () => {
        try {
          const rows = autoPreviewResults
            .filter((r) => r.refereeId !== null)
            .map((r) => ({ match_id: r.matchId, referee_id: r.refereeId, role: r.role }));
          await createRefereeAssignments(rows);
          document.getElementById('auto_preview_wrap').innerHTML = '<p>Zuweisungen angelegt.</p>';
          autoPreviewResults = null;
          await renderAssignments();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      };
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
```

Update `selectTournament` once more to also refresh the auto-assignment
category checkboxes:

```js
  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    await renderRefTable();
    await refreshAssignReferees();
    const categories = await refreshAssignCategories(tournamentId);
    if (categories[0]) await selectCategoryForAssignment(categories[0].id);
    await refreshAutoCategories(tournamentId);
  }
```

- [ ] **Step 3: Write the failing e2e test**

Append to `tests/e2e/referees-flows.spec.mjs`:

```js
test('admin can auto-assign referees for a category and commit the preview', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Auto Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Referees Auto Tournament' });
  await page.fill('#c_name', 'Referees Auto Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=courts]');
  await page.selectOption('#court_tournament', { label: 'Referees Auto Tournament' });
  await page.fill('#court_name', 'Referees Auto Court');
  await page.click('#courtForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Referees Auto Tournament' });
  await page.selectOption('#team_category', { label: 'Referees Auto Category' });
  for (const name of ['RA Team A', 'RA Team B']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=schedule]');
  await page.selectOption('#sg_tournament', { label: 'Referees Auto Tournament' });
  await page.selectOption('#sg_category', { label: 'Referees Auto Category' });
  await page.fill('#sg_start', '2026-07-23T09:00');
  await page.fill('#sg_end', '2026-07-23T18:00');
  await page.click('#sg_preview');
  await expect(page.locator('#sg_preview_wrap table tbody tr')).toHaveCount(1);
  await page.click('#sg_commit');
  await expect(page.locator('#sg_preview_wrap')).toContainText('Spielplan angelegt');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Auto Tournament' });
  for (const name of ['Auto Ref One', 'Auto Ref Two']) {
    await page.fill('#ref_name', name);
    await page.fill('#ref_country', 'Neutralia');
    await page.click('#refForm button[type=submit]');
    await expect(page.locator('#refTableWrap table tbody')).toContainText(name);
  }

  await page.locator('#auto_roles input[value="Recording Clerk"]').check();
  for (const role of ['1st Referee', '2nd Referee', 'Assistant Referee 1', 'Assistant Referee 2']) {
    await page.locator(`#auto_roles input[value="${role}"]`).uncheck();
  }
  await page.click('#auto_preview');
  await expect(page.locator('#auto_preview_wrap table tbody tr')).toHaveCount(1);
  await expect(page.locator('#auto_preview_wrap table tbody')).toContainText('Recording Clerk');
  await page.click('#auto_commit');
  await expect(page.locator('#auto_preview_wrap')).toContainText('Zuweisungen angelegt');
});
```

- [ ] **Step 4: Run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/referees-flows.spec.mjs -g "auto-assign"`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 5: Commit**

```bash
git add admin/db.js admin/screens/referees.js tests/e2e/referees-flows.spec.mjs
git commit -m "feat: add automatic referee assignment UI with preview"
```

---

### Task 6: Workload overview

**Files:**
- Modify: `admin/screens/referees.js`
- Modify: `tests/e2e/referees-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `listReferees`, `listMatchesForTournament`,
  `listAssignmentsForMatchIds` from earlier tasks.
- Produces: nothing new consumed by later tasks — this is the last UI
  section of the `referees` screen.

- [ ] **Step 1: Extend `admin/screens/referees.js`**

Add this markup after the auto-assignment section's `<div
id="auto_preview_wrap"></div>` (still inside the top-level template
literal, as the final section):

```html
    <h3>Workload-Übersicht</h3>
    <div id="workloadWrap"></div>
```

Add this function near the other render helpers (e.g. right after
`renderAssignments`):

```js
  function dayKey(isoString) {
    return isoString ? isoString.slice(0, 10) : null;
  }

  async function renderWorkload() {
    if (!currentTournamentId) {
      document.getElementById('workloadWrap').innerHTML = '';
      return;
    }
    const [referees, matches] = await Promise.all([
      listReferees(currentTournamentId),
      listMatchesForTournament(currentTournamentId),
    ]);
    const matchIds = matches.map((m) => m.id);
    const assignments = await listAssignmentsForMatchIds(matchIds);
    const matchById = Object.fromEntries(matches.map((m) => [m.id, m]));

    const days = [...new Set(matches.map((m) => dayKey(m.scheduled_time)).filter(Boolean))].sort();

    const countsByReferee = Object.fromEntries(referees.map((r) => [r.id, { total: 0, byDay: {} }]));
    for (const a of assignments) {
      if (!countsByReferee[a.referee_id]) continue;
      countsByReferee[a.referee_id].total++;
      const day = dayKey(matchById[a.match_id]?.scheduled_time);
      if (day) {
        countsByReferee[a.referee_id].byDay[day] = (countsByReferee[a.referee_id].byDay[day] || 0) + 1;
      }
    }

    document.getElementById('workloadWrap').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Land</th><th>Gesamt</th>${days.map((d) => `<th>${escapeHtml(d)}</th>`).join('')}</tr></thead>
        <tbody>${referees.map((r) => `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.country)}</td>
            <td>${countsByReferee[r.id].total}</td>
            ${days.map((d) => `<td>${countsByReferee[r.id].byDay[d] || 0}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>`;
  }
```

Call `renderWorkload()` at the end of `selectTournament` (which already
calls `renderRefTable`, `refreshAssignReferees`,
`refreshAssignCategories`/`selectCategoryForAssignment`, and
`refreshAutoCategories`):

```js
  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    await renderRefTable();
    await refreshAssignReferees();
    const categories = await refreshAssignCategories(tournamentId);
    if (categories[0]) await selectCategoryForAssignment(categories[0].id);
    await refreshAutoCategories(tournamentId);
    await renderWorkload();
  }
```

Also call `renderWorkload()` at the end of the `refForm` submit handler
(so a newly created referee shows up in the table immediately) and at the
end of the `auto_commit` click handler (Task 5, so newly written
assignments are reflected without a full screen reload):

In the `refForm` submit handler, after the `await refreshAssignReferees();`
line added in Task 3, add:

```js
      await renderWorkload();
```

In the `auto_commit` click handler, after `await renderAssignments();`,
add:

```js
      await renderWorkload();
```

- [ ] **Step 2: Write the failing e2e test**

Append to `tests/e2e/referees-flows.spec.mjs`:

```js
test('workload overview shows the correct total after an assignment', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Workload Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Referees Workload Tournament' });
  await page.fill('#c_name', 'Referees Workload Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Referees Workload Tournament' });
  await page.selectOption('#team_category', { label: 'Referees Workload Category' });
  for (const name of ['RW Team A', 'RW Team B']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Referees Workload Tournament' });
  await page.selectOption('#match_category', { label: 'Referees Workload Category' });
  await page.selectOption('#match_team_a', { label: 'RW Team A' });
  await page.selectOption('#match_team_b', { label: 'RW Team B' });
  await page.fill('#match_round', 'RW Match');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('RW Match');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Workload Tournament' });
  await page.fill('#ref_name', 'Workload Ref');
  await page.fill('#ref_country', 'Neutralia');
  await page.click('#refForm button[type=submit]');
  await expect(page.locator('#workloadWrap table tbody')).toContainText('Workload Ref');
  await expect(page.locator('#workloadWrap table tbody tr', { hasText: 'Workload Ref' })).toContainText('0');

  await page.selectOption('#assign_category', { label: 'Referees Workload Category' });
  await page.selectOption('#assign_match', { label: /RW Match/ });
  await page.selectOption('#assign_referee', { label: 'Workload Ref (Neutralia)' });
  await page.selectOption('#assign_role_select', '1st Referee');
  await page.click('#assignForm button[type=submit]');
  await expect(page.locator('#assignmentsWrap table tbody')).toContainText('Workload Ref');

  const workloadRow = page.locator('#workloadWrap table tbody tr', { hasText: 'Workload Ref' });
  await expect(workloadRow.locator('td').nth(2)).toHaveText('1');
});
```

- [ ] **Step 3: Run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/referees-flows.spec.mjs -g "workload overview"`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 4: Commit**

```bash
git add admin/screens/referees.js tests/e2e/referees-flows.spec.mjs
git commit -m "feat: add referee workload overview"
```

---

### Task 7: Full test suite run

**Files:** none (verification task).

- [ ] **Step 1: Reset the local stack and reseed**

```bash
npx supabase db reset
set -a && source .env && set +a
node scripts/seed-roles.mjs
node scripts/generate-admin-config.mjs
```

- [ ] **Step 2: Run the full suite**

```bash
npm run test
```

Expected: all of `test:unit`, `test:rls`, `test:e2e` pass — unit gains 8
tests (Task 4), rls gains 7 tests (Task 1) on top of the existing 46, e2e
gains 5 new tests (Tasks 2, 3, 5, 6) on top of the existing 15, plus the
Task 1 Step 8 confirmation that Game Report's existing tests still pass.

- [ ] **Step 3: Restore production config**

```bash
git checkout -- admin/config.js
git status --short
```

Expected: clean (only the config file was touched by the local test run).

---

### Task 8: Deploy to the real Supabase project

**Files:** none (deployment task).

- [ ] **Step 1: Push the new migration**

```bash
npx supabase link --project-ref <production-project-ref>
npx supabase db push
```

- [ ] **Step 2: Confirm the RPC/schema tests pass against production**

Point `.env` at the production project temporarily (same pattern as
Teilprojekt 2's Task 13 and Teilprojekt 3's Task 7) and run:

```bash
set -a && source .env && set +a
node --test tests/schema-referees.test.mjs
```

Expected: all pass against production. Restore `.env` to local values and
`git checkout -- admin/config.js` afterward.

- [ ] **Step 3: Verify manually against production**

Using the production admin login (app served locally with `admin/config.js`
pointed at production, same approach as Teilprojekt 3), or via a scripted
Playwright flow:
1. Create a referee, confirm it appears in the roster and the workload
   table with a `0` total.
2. Manually assign it to a match; confirm the assignment appears and the
   workload total increases.
3. Run the automatic assignment generator for a category; confirm the
   preview and commit both work.
4. Delete all test rows created in steps 1–3 (assignments, referees, and
   any throwaway tournament/category/teams/matches) so production data
   stays clean.

---

## Self-Review Notes

- **Spec coverage:** `referees` table + column swap + double-booking
  trigger (Task 1), interest-conflict warning restricted to "1st Referee"
  with unresolved-KO-slot skip (Task 3), automatic assignment algorithm
  incl. all named hard/soft criteria and the "same referee twice in one
  match" exclusion (Task 4), preview-before-write UI (Task 5), workload
  overview with day breakdown and the "no `scheduled_time` → counts in
  total only" rule (Task 6) — all covered. Out-of-scope items (role
  variety, certification level, court distance, own-country rule for other
  roles) are deliberately absent from every task.
- **Fixed two real bugs found during self-review, not just spec gaps:**
  (1) Task 4's original test draft covered every hard/soft rule except the
  "rest since last assignment" rule — added a dedicated test that isolates
  it from the count tie-breaker (both referees start with equal counts, so
  only the rest-rule score can explain the outcome). (2) Task 3's
  `refForm` submit handler never refreshed the assignment section's
  referee dropdown after creating a referee, which would have made Task
  3's own e2e test fail (selecting a referee that doesn't exist in the
  dropdown yet) — added `await refreshAssignReferees();` to that handler,
  and updated Task 6's later instruction (which inserts after that same
  line) to match the corrected handler body.
- **Consequential fix folded into Task 1, not deferred:** the schema swap
  breaks `admin/screens/game-report.js`'s existing referee display (reads
  the now-removed `referee_name`). Fixed in the same task rather than left
  for a later task to discover, following the precedent set by Teilprojekt
  3's Task 2 (which fixed a test invalidated by its own schema change in
  the same task).
- **Task ordering:** Task 1 is a hard prerequisite for everything.
  Task 2 (roster) has no other dependency. Task 3 (manual assignment)
  depends on Task 2's `listReferees` and reuses the pre-existing
  `listMatches`. Task 4 (pure algorithm) is fully independent — could run
  in parallel with 2/3 if this were executed as parallel work, but this
  plan is written for sequential subagent-driven execution. Task 5 (auto
  UI) depends on Task 4's function and extends `listMatchesForTournament`
  from Teilprojekt 3 — Task 6 depends on that same extended shape, so Task
  6 must follow Task 5. Tasks 2, 3, 5, 6 all incrementally extend the same
  `admin/screens/referees.js` file in strict sequence to avoid conflicting
  edits within a single-implementer session, mirroring how
  `admin/screens/game-report.js` grew across Teilprojekt 2's tasks 7–11.
- **Removed dead code inline:** an earlier draft of Task 5's e2e test
  contained a stray `document.title;` no-op line — deleted directly from
  the test code (not left in with a follow-up "remove this" step), per the
  plan's own "no placeholders, no dead code" standard.
- **Type consistency check:** `assignReferees`'s input/output shapes
  (`matchId`/`role`/`refereeId`, `team_a_name`/`team_b_name`,
  `available_from`/`available_to` as `YYYY-MM-DD` strings) are used
  identically in Task 4's tests and Task 5's screen code. `listReferees`'s
  return shape (`id, tournament_id, name, country, available_from,
  available_to`) is consumed unchanged by Tasks 3, 5, and 6.
  `listMatchesForTournament`'s extended shape (Task 5) is a superset of
  its Teilprojekt-3 shape, so nothing already depending on the old fields
  breaks.
