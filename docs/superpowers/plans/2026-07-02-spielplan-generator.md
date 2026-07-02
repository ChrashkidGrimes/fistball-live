# Teilprojekt 3: Spielplan-Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a round-robin group-stage generator and a KO-bracket skeleton with
automatic winner/loser slot resolution to the existing Fistball EMS admin app.

**Architecture:** Two independent additions on top of the existing Supabase +
vanilla-JS admin app (Teilprojekt 1/2): (1) a pure client-side round-robin
pairing + court/time slot algorithm feeding the existing `matches` insert
path, and (2) schema + RPC changes that let a match's `team_a_id`/`team_b_id`
be "pending" (waiting on another match's winner/loser) and auto-resolve when
that source match is finished via a new `finish_match()` RPC.

**Tech Stack:** Postgres (Supabase), `security definer` PL/pgSQL functions,
vanilla ES modules (no framework/bundler), `node --test`, Playwright.

## Global Constraints

- `matches.team_a_id`/`team_b_id` become nullable; a match must have exactly
  one of (fixed team) or (source match) per side — enforced by a `check`
  constraint using `<>` as XOR on `is not null` expressions.
- `team_a_source_match_id`/`team_b_source_match_id` reference `matches(id)`
  `on delete restrict` (not `set null` — nulling the FK while the team is
  still unresolved would itself violate the XOR constraint).
- New `matches.winner_team_id` (`references teams(id) on delete set null`) —
  the first persistent match-level winner; previously only `sets.winner_team_id`
  existed (per-set, not per-match).
- `finish_match(p_match_id uuid, p_winner_team_id_override uuid default null)`
  replaces the old direct `UPDATE matches SET status = 'finished'` as the
  only path to `status = 'finished'`. Precondition: `status <> 'finished'`
  (**not** `status = 'live'` — the current app already finishes matches that
  were never started, see `tests/e2e/admin-flows.spec.mjs`; that capability
  must not regress).
- Direct admin `UPDATE` to `status = 'finished'` is blocked by a
  `before update` trigger using a transaction-local `set_config` guard
  (`fistball.allow_finish`), not by narrowing the existing `admin write
  matches` RLS policy — the policy still needs to allow admin to edit other
  match fields (`scheduled_time`, `court_id`, `round_label`, …) directly.
- No RPC for round-robin pairing/slot generation — it's a pure, stateless
  computation with no authorization concerns; only the final `insert` into
  `matches` goes through the DB (existing admin-only RLS policy, unchanged).
- Court/time collision checks for the group-stage generator span **all**
  matches in the tournament, not just the category being generated.
- Regenerating a category's matches is only allowed when every existing
  match in that category still has `status = 'scheduled'`.
- Automatic mapping of group standings into the first KO round is explicitly
  out of scope — stays a manual admin step, same as today.
- `best_of` defaults to `5`, matching the existing convention in `admin/db.js`.

## File Structure

- `supabase/migrations/<ts>_spielplan_schema.sql` — nullable team columns,
  source columns, `winner_team_id`, XOR check constraints (Task 1).
- `supabase/migrations/<ts>_finish_match.sql` — `compute_match_winner()`,
  `finish_match()`, the direct-finish-prevention trigger (Task 2).
- `tests/schema-spielplan.test.mjs` — FK/constraint tests for the new columns
  (Task 1).
- `tests/finish-match-rpc.test.mjs` — RPC/RLS tests for `finish_match`
  (Task 2).
- `admin/schedule-generator.js` — pure functions: `computeRoundRobinRounds`,
  `assignScheduleSlots`. No Supabase import, no DOM (Task 3).
- `admin/schedule-generator.test.mjs` — unit tests for the above (Task 3).
- `admin/screens/schedule.js` — new "Spielplan" admin screen, group-stage
  generator UI (Task 4).
- `admin/db.js` — modified: `listMatches`, `createMatch`, `finishMatch`;
  added: `listMatchesForTournament`, `createMatches`,
  `deleteMatchesByCategory` (Task 4), `listMatchSourceOptions` (Task 5).
- `admin/screens/matches.js` — modified: Forfeit control + error handling
  (Task 2), source-based team selection + placeholder display (Task 5).
- `admin/app.js`, `admin/index.html` — nav entry + script tag for the new
  screen (Task 4).
- `tests/e2e/admin-flows.spec.mjs` — modified: existing finish-match test
  updated to use the Forfeit path (Task 2); new schedule-generator e2e test
  (Task 4).
- `tests/e2e/matches-sources.spec.mjs` — new e2e test for KO winner/loser
  auto-resolution (Task 5).
- `package.json` — `test:unit` script gains `admin/schedule-generator.test.mjs`
  (Task 3); `test:rls` script gains the two new RPC/schema test files
  (Task 1, Task 2).

---

### Task 1: Schema — nullable team columns, source columns, winner_team_id

**Files:**
- Create: `supabase/migrations/<ts>_spielplan_schema.sql`
- Test: `tests/schema-spielplan.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `matches` table from Teilprojekt 1
  (`supabase/migrations/20260701202337_schema.sql`).
- Produces: `matches.team_a_id`/`team_b_id` (now nullable),
  `matches.team_a_source_match_id` (`uuid references matches(id) on delete
  restrict`), `matches.team_a_source_outcome` (`text check in ('winner',
  'loser')`), `matches.team_b_source_match_id`, `matches.team_b_source_outcome`
  (analog), `matches.winner_team_id` (`uuid references teams(id) on delete
  set null`) — Task 2's `finish_match()` writes/reads all of these.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new spielplan_schema`

- [ ] **Step 2: Write the schema changes**

Put this in `supabase/migrations/<ts>_spielplan_schema.sql`:

```sql
alter table matches alter column team_a_id drop not null;
alter table matches alter column team_b_id drop not null;

alter table matches add column team_a_source_match_id uuid references matches(id) on delete restrict;
alter table matches add column team_a_source_outcome text check (team_a_source_outcome in ('winner', 'loser'));
alter table matches add column team_b_source_match_id uuid references matches(id) on delete restrict;
alter table matches add column team_b_source_outcome text check (team_b_source_outcome in ('winner', 'loser'));
alter table matches add column winner_team_id uuid references teams(id) on delete set null;

alter table matches add constraint team_a_fixed_xor_source
  check ((team_a_id is not null) <> (team_a_source_match_id is not null));
alter table matches add constraint team_b_fixed_xor_source
  check ((team_b_id is not null) <> (team_b_source_match_id is not null));
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Write the failing tests**

Create `tests/schema-spielplan.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)');

const db = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, matchAId;

before(async () => {
  const t = await db.from('tournaments').insert({
    name: 'Spielplan Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await db.from('categories').insert({
    tournament_id: tournamentId, name: 'Spielplan Schema Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await db.from('teams').insert([
    { category_id: categoryId, name: 'Spielplan Schema Team A' },
    { category_id: categoryId, name: 'Spielplan Schema Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999400,
  }).select().single();
  matchAId = m.data.id;
});

after(async () => {
  await db.from('matches').delete().eq('category_id', categoryId);
  await db.from('teams').delete().in('id', [teamAId, teamBId]);
  await db.from('categories').delete().eq('id', categoryId);
  await db.from('tournaments').delete().eq('id', tournamentId);
});

test('a match can be created with a source instead of a fixed team_a', async () => {
  const { data, error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: matchAId, team_a_source_outcome: 'winner',
    team_b_id: teamBId, sheet_match_nr: 999401,
  }).select().single();
  assert.equal(error, null);
  assert.equal(data.team_a_id, null);
  assert.equal(data.team_a_source_match_id, matchAId);
  await db.from('matches').delete().eq('id', data.id);
});

test('a match cannot have both a fixed team_a and a source (xor constraint)', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_a_source_match_id: matchAId, team_a_source_outcome: 'winner',
    team_b_id: teamBId, sheet_match_nr: 999402,
  });
  assert.ok(error, 'expected the xor check constraint to reject this row');
});

test('a match cannot have neither a fixed team_a nor a source (xor constraint)', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_b_id: teamBId, sheet_match_nr: 999403,
  });
  assert.ok(error, 'expected the xor check constraint to reject this row');
});

test('team_a_source_outcome only accepts winner or loser', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: matchAId, team_a_source_outcome: 'bogus',
    team_b_id: teamBId, sheet_match_nr: 999404,
  });
  assert.ok(error, 'expected the check constraint on team_a_source_outcome to reject an invalid value');
});

test('deleting a source match that a dependent still needs is blocked (on delete restrict)', async () => {
  const source = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999405,
  }).select().single();
  const dependent = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: source.data.id, team_a_source_outcome: 'winner',
    team_b_id: teamBId, sheet_match_nr: 999406,
  }).select().single();
  const { error } = await db.from('matches').delete().eq('id', source.data.id);
  assert.ok(error, 'expected FK restrict to block deleting a still-referenced source match');
  await db.from('matches').delete().eq('id', dependent.data.id);
  await db.from('matches').delete().eq('id', source.data.id);
});

test('winner_team_id defaults to null and accepts a team from the match', async () => {
  const { data, error } = await db.from('matches').update({ winner_team_id: teamAId }).eq('id', matchAId).select().single();
  assert.equal(error, null);
  assert.equal(data.winner_team_id, teamAId);
  await db.from('matches').update({ winner_team_id: null }).eq('id', matchAId);
});
```

- [ ] **Step 5: Run the tests**

Run: `set -a && source .env && set +a && node --test tests/schema-spielplan.test.mjs`
Expected: `# pass 5`.

- [ ] **Step 6: Wire into `test:rls`**

In `package.json`, change:

```json
"test:rls": "node --test tests/rls.test.mjs tests/migrate-sheet-data.test.mjs tests/schema.test.mjs tests/schema-sumula.test.mjs tests/game-report-rls.test.mjs tests/game-report-rpc.test.mjs",
```

to:

```json
"test:rls": "node --test tests/rls.test.mjs tests/migrate-sheet-data.test.mjs tests/schema.test.mjs tests/schema-sumula.test.mjs tests/game-report-rls.test.mjs tests/game-report-rpc.test.mjs tests/schema-spielplan.test.mjs tests/finish-match-rpc.test.mjs",
```

(`tests/finish-match-rpc.test.mjs` doesn't exist yet — it's created in Task 2.
Referencing it now means Task 1's `npm run test:rls` will fail until Task 2
lands; that's expected and matches how Teilprojekt 2 staged its own
multi-task test wiring. Task 2 must actually create the file before this
script passes again.)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/schema-spielplan.test.mjs package.json
git commit -m "feat: nullable match teams + source/winner columns for KO bracket skeleton"
```

---

### Task 2: `finish_match` RPC, direct-finish guard trigger, Forfeit UI

**Files:**
- Create: `supabase/migrations/<ts>_finish_match.sql`
- Test: `tests/finish-match-rpc.test.mjs`
- Modify: `admin/db.js` (`listMatches`, `finishMatch`)
- Modify: `admin/screens/matches.js`
- Modify: `tests/e2e/admin-flows.spec.mjs`

**Interfaces:**
- Consumes: `matches.team_a_source_match_id`/`team_a_source_outcome`/
  `team_b_source_match_id`/`team_b_source_outcome`/`winner_team_id` from
  Task 1. Consumes `public.auth_role()` from
  `supabase/migrations/20260701202914_rls.sql`.
- Produces: `finish_match(p_match_id uuid, p_winner_team_id_override uuid
  default null)` RPC — Task 5's UI also calls this. `admin/db.js`'s
  `finishMatch(id, winnerTeamIdOverride)` — Task 5 reuses this signature
  unchanged.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new finish_match`

- [ ] **Step 2: Write the RPC, helper, and guard trigger**

Put this in `supabase/migrations/<ts>_finish_match.sql`:

```sql
create or replace function public.compute_match_winner(p_match_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_won_a integer;
  v_won_b integer;
  v_needed integer;
begin
  select * into v_match from matches where id = p_match_id;
  select count(*) into v_won_a from sets where match_id = p_match_id and winner_team_id = v_match.team_a_id;
  select count(*) into v_won_b from sets where match_id = p_match_id and winner_team_id = v_match.team_b_id;
  v_needed := ceil(v_match.best_of / 2.0);
  if v_won_a >= v_needed then return v_match.team_a_id; end if;
  if v_won_b >= v_needed then return v_match.team_b_id; end if;
  return null;
end;
$$;

revoke all on function public.compute_match_winner(uuid) from public;
grant execute on function public.compute_match_winner(uuid) to authenticated;

create or replace function public.finish_match(p_match_id uuid, p_winner_team_id_override uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_winner uuid;
  v_loser uuid;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'not authorized';
  end if;

  select * into v_match from matches where id = p_match_id for update;
  if v_match.id is null then
    raise exception 'match not found';
  end if;
  if v_match.status = 'finished' then
    raise exception 'match is already finished';
  end if;
  if v_match.team_a_id is null or v_match.team_b_id is null then
    raise exception 'match teams are not yet resolved';
  end if;

  if p_winner_team_id_override is not null then
    if p_winner_team_id_override not in (v_match.team_a_id, v_match.team_b_id) then
      raise exception 'winner override must be one of the match teams';
    end if;
    v_winner := p_winner_team_id_override;
  else
    v_winner := public.compute_match_winner(p_match_id);
    if v_winner is null then
      raise exception 'no decisive winner yet — record more sets or use the winner override';
    end if;
  end if;

  v_loser := case when v_winner = v_match.team_a_id then v_match.team_b_id else v_match.team_a_id end;

  perform set_config('fistball.allow_finish', 'on', true);
  update matches set status = 'finished', winner_team_id = v_winner where id = p_match_id;

  update matches set
    team_a_id = case team_a_source_outcome when 'winner' then v_winner when 'loser' then v_loser else team_a_id end,
    team_a_source_match_id = null,
    team_a_source_outcome = null
  where team_a_source_match_id = p_match_id;

  update matches set
    team_b_id = case team_b_source_outcome when 'winner' then v_winner when 'loser' then v_loser else team_b_id end,
    team_b_source_match_id = null,
    team_b_source_outcome = null
  where team_b_source_match_id = p_match_id;
end;
$$;

revoke all on function public.finish_match(uuid, uuid) from public;
grant execute on function public.finish_match(uuid, uuid) to authenticated;

create or replace function public.prevent_direct_match_finish() returns trigger
language plpgsql as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished'
     and current_setting('fistball.allow_finish', true) is distinct from 'on' then
    raise exception 'status must be set to finished via finish_match()';
  end if;
  return new;
end;
$$;

create trigger matches_prevent_direct_finish
  before update on matches
  for each row execute function public.prevent_direct_match_finish();
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Write the failing tests**

Create `tests/finish-match-rpc.test.mjs`:

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
let tournamentId, categoryId, teamAId, teamBId, admin, scorer;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Finish Match RPC Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Finish Match RPC Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Finish Match RPC Team A' },
    { category_id: categoryId, name: 'Finish Match RPC Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;

  admin = createClient(url, anonKey);
  await admin.auth.signInWithPassword({ email: 'admin@fistball-ems.local', password: adminPassword });
  scorer = createClient(url, anonKey);
  await scorer.auth.signInWithPassword({ email: 'scorer@fistball-ems.local', password: scorerPassword });
});

after(async () => {
  await service.from('matches').delete().eq('category_id', categoryId);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

async function makeMatch(sheetNr, extra = {}) {
  const { data } = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: sheetNr, best_of: 3, ...extra,
  }).select().single();
  return data.id;
}

test('finish_match computes the winner from decisive sets and works from status=live', async () => {
  const matchId = await makeMatch(999500, { status: 'live' });
  await service.from('sets').insert([
    { match_id: matchId, set_number: 1, points_a: 11, points_b: 5, winner_team_id: teamAId },
    { match_id: matchId, set_number: 2, points_a: 11, points_b: 7, winner_team_id: teamAId },
  ]);
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId });
  assert.equal(error, null);
  const { data } = await service.from('matches').select('status, winner_team_id').eq('id', matchId).single();
  assert.equal(data.status, 'finished');
  assert.equal(data.winner_team_id, teamAId);
});

test('finish_match also works from status=scheduled when sets are already decisive', async () => {
  const matchId = await makeMatch(999501, { status: 'scheduled' });
  await service.from('sets').insert([
    { match_id: matchId, set_number: 1, points_a: 11, points_b: 5, winner_team_id: teamAId },
    { match_id: matchId, set_number: 2, points_a: 11, points_b: 7, winner_team_id: teamAId },
  ]);
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId });
  assert.equal(error, null);
  const { data } = await service.from('matches').select('status').eq('id', matchId).single();
  assert.equal(data.status, 'finished');
});

test('finish_match rejects a match with no decisive winner and no override', async () => {
  const matchId = await makeMatch(999502, { status: 'scheduled' });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId });
  assert.ok(error, 'expected an error, no sets recorded');
});

test('finish_match accepts an explicit winner override with no sets (forfeit case)', async () => {
  const matchId = await makeMatch(999503, { status: 'scheduled' });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamBId });
  assert.equal(error, null);
  const { data } = await service.from('matches').select('status, winner_team_id').eq('id', matchId).single();
  assert.equal(data.status, 'finished');
  assert.equal(data.winner_team_id, teamBId);
});

test('finish_match rejects an override that is not one of the match teams', async () => {
  const matchId = await makeMatch(999504, { status: 'scheduled' });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: categoryId });
  assert.ok(error, 'expected rejection, categoryId is not a team of this match');
});

test('finish_match rejects a match that is already finished', async () => {
  const matchId = await makeMatch(999505, { status: 'scheduled' });
  await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamAId });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamBId });
  assert.ok(error, 'expected rejection, match already finished');
});

test('finish_match resolves a dependent match\'s winner and loser slots', async () => {
  const sourceId = await makeMatch(999506, { status: 'live' });
  const winnerSlot = await service.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: sourceId, team_a_source_outcome: 'winner',
    team_b_id: teamAId, sheet_match_nr: 999507,
  }).select().single();
  const loserSlot = await service.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: sourceId, team_a_source_outcome: 'loser',
    team_b_id: teamAId, sheet_match_nr: 999508,
  }).select().single();

  const { error } = await admin.rpc('finish_match', { p_match_id: sourceId, p_winner_team_id_override: teamAId });
  assert.equal(error, null);

  const { data: resolvedWinnerSlot } = await service.from('matches')
    .select('team_a_id, team_a_source_match_id').eq('id', winnerSlot.data.id).single();
  assert.equal(resolvedWinnerSlot.team_a_id, teamAId);
  assert.equal(resolvedWinnerSlot.team_a_source_match_id, null);

  const { data: resolvedLoserSlot } = await service.from('matches')
    .select('team_a_id, team_a_source_match_id').eq('id', loserSlot.data.id).single();
  assert.equal(resolvedLoserSlot.team_a_id, teamBId);
  assert.equal(resolvedLoserSlot.team_a_source_match_id, null);
});

test('scorer cannot call finish_match (admin only)', async () => {
  const matchId = await makeMatch(999509, { status: 'scheduled' });
  const { error } = await scorer.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamAId });
  assert.ok(error, 'expected rejection, scorer is not admin');
});

test('admin can no longer set status=finished via a direct table update', async () => {
  const matchId = await makeMatch(999510, { status: 'scheduled' });
  const { error } = await admin.from('matches').update({ status: 'finished' }).eq('id', matchId);
  assert.ok(error, 'expected the direct-finish guard trigger to reject this update');
});
```

- [ ] **Step 5: Run the tests**

Run: `set -a && source .env && set +a && node --test tests/finish-match-rpc.test.mjs`
Expected: `# pass 9`.

- [ ] **Step 6: Update `admin/db.js`**

Replace the existing `listMatches` function:

```js
export async function listMatches(categoryId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, status, round_label, best_of, team_a_id, team_b_id, winner_team_id, team_a:team_a_id(name), team_b:team_b_id(name), court:court_id(name)')
    .eq('category_id', categoryId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}
```

Replace the existing `finishMatch` function:

```js
export async function finishMatch(id, winnerTeamIdOverride) {
  const { error } = await getClient().rpc('finish_match', {
    p_match_id: id,
    p_winner_team_id_override: winnerTeamIdOverride || null,
  });
  if (error) throw error;
}
```

- [ ] **Step 7: Update `admin/screens/matches.js`**

Add a `<p id="matchListError">` right after `<div id="matchTableWrap"></div>`
in the template string:

```js
    <div id="matchTableWrap"></div>
    <p id="matchListError" class="error" hidden></p>
```

Replace the `renderTable` function's row template and the block below it that
wires up `[data-finish]`:

```js
  async function renderTable() {
    const matches = currentCategoryId ? await listMatches(currentCategoryId) : [];
    document.getElementById('matchTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Team A</th><th>Team B</th><th>Court</th><th>Status</th><th></th></tr></thead>
        <tbody>${matches.map((m) => `
          <tr>
            <td>${escapeHtml(m.team_a?.name ?? '')}</td>
            <td>${escapeHtml(m.team_b?.name ?? '')}</td>
            <td>${escapeHtml(m.court?.name ?? '')}</td>
            <td>${escapeHtml(m.status)}</td>
            <td>${role === 'admin' && m.status !== 'finished' && m.team_a_id && m.team_b_id
              ? `<button data-finish="${m.id}">Finished</button>
                 <button data-forfeit-toggle="${m.id}">Forfeit</button>
                 <span id="forfeit-${m.id}" hidden>
                   <button data-forfeit-winner="${m.id}|${m.team_a_id}">${escapeHtml(m.team_a.name)} gewinnt</button>
                   <button data-forfeit-winner="${m.id}|${m.team_b_id}">${escapeHtml(m.team_b.name)} gewinnt</button>
                 </span>`
              : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    const listErrorEl = document.getElementById('matchListError');
    document.querySelectorAll('[data-finish]').forEach((btn) => {
      btn.onclick = async () => {
        listErrorEl.hidden = true;
        try {
          await finishMatch(btn.dataset.finish);
          await renderTable();
        } catch (err) {
          listErrorEl.textContent = err.message;
          listErrorEl.hidden = false;
        }
      };
    });
    document.querySelectorAll('[data-forfeit-toggle]').forEach((btn) => {
      btn.onclick = () => {
        const span = document.getElementById(`forfeit-${btn.dataset.forfeitToggle}`);
        span.hidden = !span.hidden;
      };
    });
    document.querySelectorAll('[data-forfeit-winner]').forEach((btn) => {
      btn.onclick = async () => {
        const [matchId, winnerId] = btn.dataset.forfeitWinner.split('|');
        listErrorEl.hidden = true;
        try {
          await finishMatch(matchId, winnerId);
          await renderTable();
        } catch (err) {
          listErrorEl.textContent = err.message;
          listErrorEl.hidden = false;
        }
      };
    });
  }
```

- [ ] **Step 8: Update the existing e2e test**

`finish_match` now requires either decisive sets or an explicit winner — a
freshly created match with zero sets can no longer be finished with a plain
"Finished" click. Update the existing test in
`tests/e2e/admin-flows.spec.mjs` to use the new Forfeit control instead.
Replace the test body (`admin can create a match and mark it finished`):

```js
test('admin can create a match and mark it finished', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#team_category', { label: 'Playwright Category' });
  await page.fill('#team_name', 'Playwright United');
  await page.click('#teamForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright United');

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#match_category', { label: 'Playwright Category' });
  await page.selectOption('#match_team_a', { label: 'Playwright FC' });
  await page.selectOption('#match_team_b', { label: 'Playwright United' });
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright FC');

  const row = page.locator('tr', { hasText: 'Playwright FC' });
  await row.locator('button[data-forfeit-toggle]').click();
  await row.locator('button[data-forfeit-winner]').first().click();
  await expect(row).toContainText('finished');
});
```

- [ ] **Step 9: Run the e2e test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/admin-flows.spec.mjs -g "mark it finished"`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations tests/finish-match-rpc.test.mjs admin/db.js admin/screens/matches.js tests/e2e/admin-flows.spec.mjs
git commit -m "feat: add finish_match RPC with winner computation, override, and dependent-slot resolution"
```

---

### Task 3: Round-robin pairing + slot-assignment (pure functions)

**Files:**
- Create: `admin/schedule-generator.js`
- Create: `admin/schedule-generator.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing (pure functions, no imports).
- Produces: `computeRoundRobinRounds(teamIds: string[]): Array<Array<[string, string]>>`,
  `assignScheduleSlots({ rounds, courtIds, startTime, endTime,
  matchDurationMinutes, breakMinutes, existingMatches }): { ok: true,
  assignments: Array<{ teamA, teamB, courtId, scheduledTime }> } | { ok:
  false, missingSlots: number }` — Task 4's screen calls both.

- [ ] **Step 1: Write the failing tests**

Create `admin/schedule-generator.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoundRobinRounds, assignScheduleSlots } from './schedule-generator.js';

test('computeRoundRobinRounds pairs every team against every other exactly once (even count)', () => {
  const rounds = computeRoundRobinRounds(['A', 'B', 'C', 'D']);
  assert.equal(rounds.length, 3);
  const allPairs = rounds.flat().map((p) => p.slice().sort().join('-'));
  const expected = ['A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D'];
  assert.deepEqual(allPairs.slice().sort(), expected);
});

test('computeRoundRobinRounds handles an odd team count with a bye', () => {
  const rounds = computeRoundRobinRounds(['A', 'B', 'C', 'D', 'E']);
  assert.equal(rounds.length, 5);
  const allPairs = rounds.flat().map((p) => p.slice().sort().join('-'));
  assert.equal(allPairs.length, 10);
  assert.equal(new Set(allPairs).size, 10);
});

test('assignScheduleSlots places every pairing on a distinct court/time with no collisions', () => {
  const rounds = [[['A', 'B'], ['C', 'D']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1', 'court2'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T18:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignments.length, 2);
  const slots = result.assignments.map((a) => `${a.courtId}|${a.scheduledTime}`);
  assert.equal(new Set(slots).size, 2);
});

test('assignScheduleSlots skips a court/time already booked by an existing match', () => {
  const rounds = [[['A', 'B']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T18:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [
      { team_a_id: 'X', team_b_id: 'Y', court_id: 'court1', scheduled_time: '2026-07-23T09:00:00Z' },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignments[0].scheduledTime, '2026-07-23T09:45:00.000Z');
});

test('assignScheduleSlots never double-books a team at the same time even across rounds', () => {
  const rounds = [[['A', 'B']], [['A', 'C']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1', 'court2'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T18:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [],
  });
  assert.equal(result.ok, true);
  const aTimes = result.assignments.filter((a) => a.teamA === 'A' || a.teamB === 'A').map((a) => a.scheduledTime);
  assert.equal(new Set(aTimes).size, 2);
});

test('assignScheduleSlots reports missing slots when the time range is too short', () => {
  const rounds = [[['A', 'B'], ['C', 'D'], ['E', 'F']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T09:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [
      { team_a_id: 'X', team_b_id: 'Y', court_id: 'court1', scheduled_time: '2026-07-23T09:00:00Z' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.missingSlots, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test admin/schedule-generator.test.mjs`
Expected: FAIL — `schedule-generator.js` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `admin/schedule-generator.js`:

```js
export function computeRoundRobinRounds(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2 !== 0) ids.push(null);
  const n = ids.length;
  const rounds = [];
  const fixed = ids[0];
  let rest = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const roundTeams = [fixed, ...rest];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = roundTeams[i];
      const b = roundTeams[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  return rounds;
}

export function assignScheduleSlots({ rounds, courtIds, startTime, endTime, matchDurationMinutes, breakMinutes, existingMatches }) {
  const stepMs = (matchDurationMinutes + breakMinutes) * 60000;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  const courtBusy = new Set();
  const teamBusy = new Set();
  for (const m of existingMatches) {
    if (!m.scheduled_time) continue;
    const iso = new Date(m.scheduled_time).toISOString();
    if (m.court_id) courtBusy.add(`${m.court_id}|${iso}`);
    if (m.team_a_id) teamBusy.add(`${m.team_a_id}|${iso}`);
    if (m.team_b_id) teamBusy.add(`${m.team_b_id}|${iso}`);
  }

  const assignments = [];
  let missingSlots = 0;

  for (const round of rounds) {
    for (const [teamA, teamB] of round) {
      let placed = false;
      for (let time = start; time <= end; time += stepMs) {
        const iso = new Date(time).toISOString();
        if (teamBusy.has(`${teamA}|${iso}`) || teamBusy.has(`${teamB}|${iso}`)) continue;
        const courtId = courtIds.find((c) => !courtBusy.has(`${c}|${iso}`));
        if (!courtId) continue;
        assignments.push({ teamA, teamB, courtId, scheduledTime: iso });
        courtBusy.add(`${courtId}|${iso}`);
        teamBusy.add(`${teamA}|${iso}`);
        teamBusy.add(`${teamB}|${iso}`);
        placed = true;
        break;
      }
      if (!placed) missingSlots++;
    }
  }

  if (missingSlots > 0) return { ok: false, missingSlots };
  return { ok: true, assignments };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test admin/schedule-generator.test.mjs`
Expected: `# pass 6`.

- [ ] **Step 5: Wire into `test:unit`**

In `package.json`, change:

```json
"test:unit": "node --test scripts/__tests__/*.test.mjs",
```

to:

```json
"test:unit": "node --test scripts/__tests__/*.test.mjs admin/schedule-generator.test.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add admin/schedule-generator.js admin/schedule-generator.test.mjs package.json
git commit -m "feat: add pure round-robin pairing and slot-assignment functions"
```

---

### Task 4: Group-stage generator screen

**Files:**
- Create: `admin/screens/schedule.js`
- Modify: `admin/db.js` (append `listMatchesForTournament`, `createMatches`,
  `deleteMatchesByCategory`)
- Modify: `admin/app.js` (nav entry)
- Modify: `admin/index.html` (script tag)
- Modify: `tests/e2e/admin-flows.spec.mjs` (new test)

**Interfaces:**
- Consumes: `computeRoundRobinRounds`, `assignScheduleSlots` from
  `admin/schedule-generator.js` (Task 3). Consumes `listTournaments`,
  `listCategories`, `listTeams`, `listCourts`, `listMatches`, `escapeHtml`
  from `admin/db.js` (Teilprojekt 1/existing).
- Produces: `listMatchesForTournament(tournamentId): Promise<Array<{id,
  category_id, team_a_id, team_b_id, court_id, scheduled_time}>>`,
  `createMatches(rows): Promise<void>`, `deleteMatchesByCategory(categoryId):
  Promise<void>` in `admin/db.js` — used only by this screen for now.

- [ ] **Step 1: Append the new `admin/db.js` functions**

Append to `admin/db.js`:

```js
export async function listMatchesForTournament(tournamentId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, category_id, team_a_id, team_b_id, court_id, scheduled_time, categories!inner(tournament_id)')
    .eq('categories.tournament_id', tournamentId);
  if (error) throw error;
  return data;
}

export async function createMatches(rows) {
  const { error } = await getClient().from('matches').insert(rows);
  if (error) throw error;
}

export async function deleteMatchesByCategory(categoryId) {
  const { error } = await getClient().from('matches').delete().eq('category_id', categoryId);
  if (error) throw error;
}
```

- [ ] **Step 2: Create the screen**

Create `admin/screens/schedule.js`:

```js
import { registerScreen } from '../app.js';
import {
  listTournaments, listCategories, listTeams, listCourts, listMatches, listMatchesForTournament,
  createMatches, deleteMatchesByCategory, escapeHtml,
} from '../db.js';
import { computeRoundRobinRounds, assignScheduleSlots } from '../schedule-generator.js';

async function render(main, { role }) {
  if (role !== 'admin') {
    main.innerHTML = '<p>Nur für Admin verfügbar.</p>';
    return;
  }

  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Spielplan — Gruppenphase generieren</h2>
    <label>Turnier<select id="sg_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="sg_category"></select></label>
    <fieldset id="sg_courts"><legend>Courts</legend></fieldset>
    <label>Start<input id="sg_start" type="datetime-local"></label>
    <label>Ende<input id="sg_end" type="datetime-local"></label>
    <label>Match-Dauer (Min)<input id="sg_duration" type="number" value="40"></label>
    <label>Pause (Min)<input id="sg_break" type="number" value="5"></label>
    <label>Rundenbezeichnung<input id="sg_round_label" value="Qualification round"></label>
    <label>Best of<input id="sg_best_of" type="number" value="5"></label>
    <button id="sg_preview">Vorschau berechnen</button>
    <p id="sgError" class="error" hidden></p>
    <div id="sg_preview_wrap"></div>
  `;

  let currentTournamentId = null;
  let currentCategoryId = null;
  let previewAssignments = null;

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('sg_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshCourts(tournamentId) {
    const courts = await listCourts(tournamentId);
    document.getElementById('sg_courts').innerHTML = '<legend>Courts</legend>' + courts.map((c) =>
      `<label><input type="checkbox" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
  }

  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    const categories = await refreshCategories(tournamentId);
    await refreshCourts(tournamentId);
    if (categories[0]) currentCategoryId = categories[0].id;
  }

  document.getElementById('sg_tournament').onchange = (e) => selectTournament(e.target.value);
  document.getElementById('sg_category').onchange = (e) => { currentCategoryId = e.target.value; };

  if (tournaments[0]) await selectTournament(tournaments[0].id);

  document.getElementById('sg_preview').onclick = async () => {
    const errorEl = document.getElementById('sgError');
    errorEl.hidden = true;
    previewAssignments = null;
    document.getElementById('sg_preview_wrap').innerHTML = '';
    try {
      const courtIds = [...document.querySelectorAll('#sg_courts input:checked')].map((el) => el.value);
      if (courtIds.length === 0) throw new Error('Mindestens ein Court auswählen.');
      const start = document.getElementById('sg_start').value;
      const end = document.getElementById('sg_end').value;
      if (!start || !end) throw new Error('Start und Ende angeben.');
      const duration = Number(document.getElementById('sg_duration').value) || 0;
      const breakMin = Number(document.getElementById('sg_break').value) || 0;
      const roundLabel = document.getElementById('sg_round_label').value.trim();
      const bestOf = Number(document.getElementById('sg_best_of').value) || 5;

      const [teams, existingCategoryMatches, allTournamentMatches] = await Promise.all([
        listTeams(currentCategoryId),
        listMatches(currentCategoryId),
        listMatchesForTournament(currentTournamentId),
      ]);
      if (teams.length < 2) throw new Error('Kategorie braucht mindestens 2 Teams.');

      const existingForCollision = allTournamentMatches.filter((m) => m.category_id !== currentCategoryId);
      const rounds = computeRoundRobinRounds(teams.map((t) => t.id));
      const result = assignScheduleSlots({
        rounds, courtIds,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        matchDurationMinutes: duration,
        breakMinutes: breakMin,
        existingMatches: existingForCollision,
      });
      if (!result.ok) throw new Error(`${result.missingSlots} Paarung(en) passen nicht in den gewählten Zeitraum/Courts.`);

      const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
      const courtName = Object.fromEntries(
        [...document.querySelectorAll('#sg_courts input')].map((el) => [el.value, el.closest('label').textContent.trim()]),
      );
      previewAssignments = result.assignments.map((a) => ({
        ...a, round_label: roundLabel, best_of: bestOf, category_id: currentCategoryId,
      }));

      const existingCount = existingCategoryMatches.length;
      const nonScheduled = existingCategoryMatches.filter((m) => m.status !== 'scheduled');
      const warning = existingCount > 0
        ? `<p>${existingCount} bestehende Matches in dieser Kategorie werden ersetzt.</p>
           <label><input type="checkbox" id="sg_confirm_replace"> Ja, ersetzen</label>`
        : '';
      const blocked = nonScheduled.length > 0
        ? `<p class="error">${nonScheduled.length} bestehende Matches sind bereits live/finished — Regenerierung nicht möglich.</p>`
        : '';

      document.getElementById('sg_preview_wrap').innerHTML = `
        ${warning}${blocked}
        <table>
          <thead><tr><th>Team A</th><th>Team B</th><th>Court</th><th>Zeit</th></tr></thead>
          <tbody>${previewAssignments.map((a) => `
            <tr>
              <td>${escapeHtml(teamName[a.teamA])}</td>
              <td>${escapeHtml(teamName[a.teamB])}</td>
              <td>${escapeHtml(courtName[a.courtId] || '')}</td>
              <td>${new Date(a.scheduledTime).toLocaleString('de-CH')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${blocked ? '' : `<button id="sg_commit">Anlegen</button>`}
      `;

      if (!blocked) {
        document.getElementById('sg_commit').onclick = async () => {
          try {
            if (existingCount > 0) {
              const confirmBox = document.getElementById('sg_confirm_replace');
              if (!confirmBox.checked) throw new Error('Bitte das Ersetzen bestätigen.');
              await deleteMatchesByCategory(currentCategoryId);
            }
            await createMatches(previewAssignments.map((a) => ({
              category_id: a.category_id,
              team_a_id: a.teamA,
              team_b_id: a.teamB,
              court_id: a.courtId,
              scheduled_time: a.scheduledTime,
              round_label: a.round_label,
              best_of: a.best_of,
            })));
            document.getElementById('sg_preview_wrap').innerHTML = '<p>Spielplan angelegt.</p>';
            previewAssignments = null;
          } catch (err) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
          }
        };
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('schedule', { render });
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
    ['game-report', 'Game Report'],
  ];
```

- [ ] **Step 4: Add the script tag**

In `admin/index.html`, add after the `matches.js` script tag:

```html
  <script type="module" src="screens/schedule.js"></script>
```

- [ ] **Step 5: Write the failing e2e test**

Append to `tests/e2e/admin-flows.spec.mjs`:

```js
test('admin can generate a round-robin group stage with courts and times', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Schedule Gen Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Schedule Gen Tournament');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Schedule Gen Tournament' });
  await page.fill('#c_name', 'Schedule Gen Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=courts]');
  await page.selectOption('#court_tournament', { label: 'Schedule Gen Tournament' });
  await page.fill('#court_name', 'Schedule Court 1');
  await page.click('#courtForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Schedule Gen Tournament' });
  await page.selectOption('#team_category', { label: 'Schedule Gen Category' });
  for (const name of ['SG Team A', 'SG Team B', 'SG Team C']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=schedule]');
  await page.selectOption('#sg_tournament', { label: 'Schedule Gen Tournament' });
  await page.selectOption('#sg_category', { label: 'Schedule Gen Category' });
  await page.fill('#sg_start', '2026-07-23T09:00');
  await page.fill('#sg_end', '2026-07-23T18:00');
  await page.click('#sg_preview');
  await expect(page.locator('#sg_preview_wrap table tbody tr')).toHaveCount(3);
  await page.click('#sg_commit');
  await expect(page.locator('#sg_preview_wrap')).toContainText('Spielplan angelegt');

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Schedule Gen Tournament' });
  await page.selectOption('#match_category', { label: 'Schedule Gen Category' });
  await expect(page.locator('table tbody tr')).toHaveCount(3);
});
```

- [ ] **Step 6: Run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/admin-flows.spec.mjs -g "round-robin group stage"`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 7: Commit**

```bash
git add admin/db.js admin/screens/schedule.js admin/app.js admin/index.html tests/e2e/admin-flows.spec.mjs
git commit -m "feat: add group-stage round-robin generator screen"
```

---

### Task 5: KO-skeleton UI — source-based team selection and auto-resolution

**Files:**
- Modify: `admin/db.js` (`listMatches`, `createMatch`; append
  `listMatchSourceOptions`)
- Modify: `admin/screens/matches.js`
- Create: `tests/e2e/matches-sources.spec.mjs`

**Interfaces:**
- Consumes: `finish_match` RPC (Task 2, via existing `finishMatch` in
  `admin/db.js`). Consumes `matches.team_a_source_match_id`/
  `team_a_source_outcome`/`team_b_source_match_id`/`team_b_source_outcome`
  (Task 1).
- Produces: `listMatchSourceOptions(tournamentId): Promise<Array<{id,
  sheet_match_nr, round_label, team_a: {name}, team_b: {name}}>>` in
  `admin/db.js`.

- [ ] **Step 1: Update `admin/db.js`**

Replace the `listMatches` function (already modified once in Task 2) with:

```js
export async function listMatches(categoryId) {
  const { data, error } = await getClient()
    .from('matches')
    .select(`
      id, status, round_label, best_of, team_a_id, team_b_id, winner_team_id,
      team_a:team_a_id(name), team_b:team_b_id(name), court:court_id(name),
      team_a_source_outcome, team_a_source_match:team_a_source_match_id(sheet_match_nr, round_label),
      team_b_source_outcome, team_b_source_match:team_b_source_match_id(sheet_match_nr, round_label)
    `)
    .eq('category_id', categoryId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}
```

Replace the `createMatch` function:

```js
export async function createMatch({
  category_id, team_a_id, team_b_id, team_a_source_match_id, team_a_source_outcome,
  team_b_source_match_id, team_b_source_outcome, court_id, round_label, best_of,
}) {
  const { error } = await getClient().from('matches').insert({
    category_id,
    team_a_id: team_a_id || null,
    team_b_id: team_b_id || null,
    team_a_source_match_id: team_a_source_match_id || null,
    team_a_source_outcome: team_a_source_outcome || null,
    team_b_source_match_id: team_b_source_match_id || null,
    team_b_source_outcome: team_b_source_outcome || null,
    court_id: court_id || null,
    round_label: round_label || null,
    best_of: best_of || 5,
  });
  if (error) throw error;
}
```

Append `listMatchSourceOptions`:

```js
export async function listMatchSourceOptions(tournamentId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, sheet_match_nr, round_label, team_a:team_a_id(name), team_b:team_b_id(name), categories!inner(tournament_id)')
    .eq('categories.tournament_id', tournamentId);
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Update `admin/screens/matches.js`**

Add a `sourceLabel` helper at the top of the file (after the imports):

```js
function sourceLabel(sourceMatch, outcome) {
  if (!sourceMatch) return '—';
  const label = sourceMatch.sheet_match_nr ? `#${sourceMatch.sheet_match_nr}` : (sourceMatch.round_label || 'Match');
  return outcome === 'winner' ? `Sieger von ${label}` : `Verlierer von ${label}`;
}
```

Update the import line to add `listMatchSourceOptions`:

```js
import {
  listTournaments, listCategories, listTeams, listCourts, listMatches, listMatchSourceOptions,
  createMatch, finishMatch, escapeHtml,
} from '../db.js';
```

Replace the `matchForm` block inside the template string (currently `Team A`,
`Team B`, `Court`, `Runde`, `Best of` labels) with:

```html
    <form id="matchForm" class="entity-form">
      <label>Team-A-Modus
        <select id="match_team_a_mode">
          <option value="fixed">Festes Team</option>
          <option value="winner">Sieger von Match</option>
          <option value="loser">Verlierer von Match</option>
        </select>
      </label>
      <label>Team A<select id="match_team_a"></select></label>
      <label>Team A — Quell-Match<select id="match_team_a_source"></select></label>
      <label>Team-B-Modus
        <select id="match_team_b_mode">
          <option value="fixed">Festes Team</option>
          <option value="winner">Sieger von Match</option>
          <option value="loser">Verlierer von Match</option>
        </select>
      </label>
      <label>Team B<select id="match_team_b"></select></label>
      <label>Team B — Quell-Match<select id="match_team_b_source"></select></label>
      <label>Court<select id="match_court"></select></label>
      <label>Runde<input id="match_round"></label>
      <label>Best of<input id="match_best_of" type="number" value="5"></label>
      <button type="submit">Anlegen</button>
      <p id="matchError" class="error" hidden></p>
    </form>
```

Add the mode-toggle wiring right after `main.innerHTML = ...` (before
`let currentCategoryId = null;`, which becomes `currentTournamentId`/
`currentCategoryId`):

```js
  let currentTournamentId = null;
  let currentCategoryId = null;

  function toggleSourceFields() {
    const aMode = document.getElementById('match_team_a_mode').value;
    document.getElementById('match_team_a').closest('label').hidden = aMode !== 'fixed';
    document.getElementById('match_team_a_source').closest('label').hidden = aMode === 'fixed';
    const bMode = document.getElementById('match_team_b_mode').value;
    document.getElementById('match_team_b').closest('label').hidden = bMode !== 'fixed';
    document.getElementById('match_team_b_source').closest('label').hidden = bMode === 'fixed';
  }
  document.getElementById('match_team_a_mode').onchange = toggleSourceFields;
  document.getElementById('match_team_b_mode').onchange = toggleSourceFields;
  toggleSourceFields();
```

Replace the two `<td>` cells for Team A/Team B in `renderTable`'s row
template with:

```js
            <td>${m.team_a ? escapeHtml(m.team_a.name) : `<em>${escapeHtml(sourceLabel(m.team_a_source_match, m.team_a_source_outcome))}</em>`}</td>
            <td>${m.team_b ? escapeHtml(m.team_b.name) : `<em>${escapeHtml(sourceLabel(m.team_b_source_match, m.team_b_source_outcome))}</em>`}</td>
```

Add `refreshSourceOptions` next to the existing `refreshTeamsAndCourts`
function:

```js
  async function refreshSourceOptions(tournamentId) {
    const options = await listMatchSourceOptions(tournamentId);
    const html = options.map((m) => {
      const label = m.sheet_match_nr ? `#${m.sheet_match_nr}` : (m.round_label || m.id);
      return `<option value="${m.id}">${escapeHtml(label)} (${escapeHtml(m.team_a?.name ?? '?')} vs ${escapeHtml(m.team_b?.name ?? '?')})</option>`;
    }).join('');
    document.getElementById('match_team_a_source').innerHTML = html;
    document.getElementById('match_team_b_source').innerHTML = html;
  }
```

Replace the tournament-select `onchange` handler and the initial-load block
below it to also track `currentTournamentId` and call
`refreshSourceOptions`:

```js
  document.getElementById('match_tournament').onchange = async (e) => {
    currentTournamentId = e.target.value;
    await refreshSourceOptions(currentTournamentId);
    const categories = await refreshCategories(currentTournamentId);
    if (categories[0]) await selectCategory(currentTournamentId, categories[0].id);
  };
  document.getElementById('match_category').onchange = (e) =>
    selectCategory(currentTournamentId, e.target.value);

  if (tournaments[0]) {
    currentTournamentId = tournaments[0].id;
    await refreshSourceOptions(currentTournamentId);
    const categories = await refreshCategories(currentTournamentId);
    if (categories[0]) await selectCategory(currentTournamentId, categories[0].id);
  }
```

Replace the `matchForm`'s `onsubmit` handler:

```js
  document.getElementById('matchForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('matchError');
    try {
      const aMode = document.getElementById('match_team_a_mode').value;
      const bMode = document.getElementById('match_team_b_mode').value;
      await createMatch({
        category_id: currentCategoryId,
        team_a_id: aMode === 'fixed' ? document.getElementById('match_team_a').value : null,
        team_a_source_match_id: aMode === 'fixed' ? null : document.getElementById('match_team_a_source').value,
        team_a_source_outcome: aMode === 'fixed' ? null : aMode,
        team_b_id: bMode === 'fixed' ? document.getElementById('match_team_b').value : null,
        team_b_source_match_id: bMode === 'fixed' ? null : document.getElementById('match_team_b_source').value,
        team_b_source_outcome: bMode === 'fixed' ? null : bMode,
        court_id: document.getElementById('match_court').value,
        round_label: document.getElementById('match_round').value.trim(),
        best_of: Number(document.getElementById('match_best_of').value) || 5,
      });
      await renderTable();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
```

- [ ] **Step 3: Write the failing e2e test**

Create `tests/e2e/matches-sources.spec.mjs`:

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

test('a KO match with a "winner of" source auto-resolves once the source match is finished', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'KO Source Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'KO Source Tournament' });
  await page.fill('#c_name', 'KO Source Category');
  await page.selectOption('#c_format', 'knockout');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'KO Source Tournament' });
  await page.selectOption('#team_category', { label: 'KO Source Category' });
  for (const name of ['KO Team A', 'KO Team B', 'KO Team C']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'KO Source Tournament' });
  await page.selectOption('#match_category', { label: 'KO Source Category' });

  // Source match: KO Team A vs KO Team B (fixed teams).
  await page.selectOption('#match_team_a', { label: 'KO Team A' });
  await page.selectOption('#match_team_b', { label: 'KO Team B' });
  await page.fill('#match_round', 'Semi-final 1');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Semi-final 1');

  // Dependent match: team A slot = winner of the source match, team B = fixed KO Team C.
  // The source-match dropdown's rendered option label is built by refreshSourceOptions()
  // as `${label} (${teamAName} vs ${teamBName})`; since this match has no sheet_match_nr
  // (only set by the sheet migration script, not the UI form), label falls back to
  // round_label — so the exact rendered text is "Semi-final 1 (KO Team A vs KO Team B)".
  // selectOption's `label` option requires an exact string match, not a regex.
  await page.selectOption('#match_team_a_mode', 'winner');
  await page.selectOption('#match_team_a_source', { label: 'Semi-final 1 (KO Team A vs KO Team B)' });
  await page.selectOption('#match_team_b', { label: 'KO Team C' });
  await page.fill('#match_round', 'Final');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Sieger von');

  // Finish the source match via forfeit (KO Team A wins), then check resolution.
  const row = page.locator('tr', { hasText: 'KO Team A' }).filter({ hasText: 'KO Team B' });
  await row.locator('button[data-forfeit-toggle]').click();
  await row.locator('button[data-forfeit-winner]').first().click();
  await expect(row).toContainText('finished');

  await expect(page.locator('table tbody')).not.toContainText('Sieger von');
  const finalRow = page.locator('tr', { hasText: 'KO Team C' });
  await expect(finalRow).toContainText('KO Team A');
});
```

- [ ] **Step 4: Run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/matches-sources.spec.mjs`
Expected: 1 passed.

Then restore production config: `git checkout -- admin/config.js`.

- [ ] **Step 5: Commit**

```bash
git add admin/db.js admin/screens/matches.js tests/e2e/matches-sources.spec.mjs
git commit -m "feat: add KO-bracket source-based team selection with auto-resolution on finish"
```

---

### Task 6: Full test suite run

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

Expected: all of `test:unit`, `test:rls`, `test:e2e` pass — unit ≥ 7 (6
existing + `admin/schedule-generator.test.mjs`'s 6 tests, minus any overlap
adjustments), rls includes the 5 new tests from
`tests/schema-spielplan.test.mjs` + 9 from `tests/finish-match-rpc.test.mjs`
on top of the existing 31, e2e includes the updated finish-match test plus
the 2 new tests from Task 4 and Task 5.

- [ ] **Step 3: Restore production config**

```bash
git checkout -- admin/config.js
git status --short
```

Expected: clean (only the config file was touched by the local test run).

---

### Task 7: Deploy to the real Supabase project

**Files:** none (deployment task).

- [ ] **Step 1: Push the new migrations**

```bash
npx supabase link --project-ref <production-project-ref>
npx supabase db push
```

- [ ] **Step 2: Confirm the RPC/schema tests pass against production**

Point `.env` at the production project temporarily (same pattern as
Teilprojekt 2's Task 13) and run:

```bash
set -a && source .env && set +a
node --test tests/finish-match-rpc.test.mjs tests/schema-spielplan.test.mjs
```

Expected: all pass against production. Restore `.env` to local values and
`git checkout -- admin/config.js` afterward.

- [ ] **Step 3: Verify manually against production**

Using the production admin login, open the deployed admin app and:
1. Open **Spielplan**, pick an existing category with no matches yet (or a
   throwaway test category), generate a small group stage, confirm the
   preview and creation both work end-to-end.
2. Open **Matches**, create one match with a "Sieger von Match #…" source
   pointing at the match from step 1, confirm it shows the placeholder
   label.
3. Use **Forfeit** on the source match, confirm the dependent match's team
   slot resolves to the winner.
4. Delete all test rows created in steps 1–3 (matches, then teams, then the
   throwaway category if one was created) so production data stays clean.

---

## Self-Review Notes

- **Spec coverage:** Datenmodell (Task 1), `finish_match` RPC incl. override
  and dependent-slot resolution (Task 2), direct-finish guard trigger
  (Task 2), Gruppenphasen-Generator incl. preview/collision-check/regenerate
  guard (Task 4), KO-Skelett UI incl. placeholder display (Task 5), Testing
  section's three bullet points (RPC/RLS tests: Task 1+2; unit tests for
  pairing/slot logic: Task 3; Playwright smoke test: Task 4+5) — all covered.
  Out-of-scope items (auto group-rank seeding, auto KO court/time, multi-hop
  chain resolution, rest-time/referee constraints) are deliberately not
  implemented anywhere in this plan.
- **Two spec corrections made before this plan was written** (both already
  applied to the committed spec, see commits `dbc7649` and `6e3d0f7`):
  `finish_match`'s precondition changed from requiring `status = 'live'` to
  just `status <> 'finished'` (the existing app finishes never-started
  matches today — Task 2 Step 8 updates the one existing test this touches);
  and the source-match FK's delete action changed from `set null` to
  `restrict` (an FK `set null` would immediately trip the XOR check
  constraint on the dependent row, so it would behave like `restrict` anyway
  but via a confusing error path — `restrict` is the honest declaration).
- **Task ordering:** Task 1 → 2 are a hard dependency chain (Task 2's RPC
  reads/writes Task 1's columns). Task 3 is independent of 1/2. Task 4
  depends only on Task 3 (+ existing Teilprojekt 1 tables) — it never touches
  source columns or `finish_match`. Task 5 depends on both Task 1 (source
  columns) and Task 2 (`finish_match`, Forfeit UI it extends). Tasks 4 and 5
  both modify `admin/screens/matches.js`/`admin/db.js` but touch disjoint
  functions/sections, so running them in plan order (4 before 5) avoids
  merge-style conflicts within a single-implementer session.
- **Type consistency check:** `assignScheduleSlots`'s returned assignment
  shape (`{ teamA, teamB, courtId, scheduledTime }`) is used identically in
  Task 3's tests and Task 4's screen. `finishMatch(id, winnerTeamIdOverride)`
  signature introduced in Task 2 is reused unchanged by Task 5's Forfeit
  buttons (already built in Task 2) — Task 5 adds no new call sites for it.
  `listMatches()`'s return shape is extended twice (Task 2, Task 5); Task 5's
  version is a superset of Task 2's, so nothing already depending on Task 2's
  fields breaks.
