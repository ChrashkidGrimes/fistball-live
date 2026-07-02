# Teilprojekt 2: Digitale Sumula ("Game Report") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Game Report" screen to the existing admin app where a scorer live-records a match — server-enforced fistball scoring rules, multi-level undo, timeouts, cards, substitutions, and extraordinary events — plus an admin-facing roster ("Kader") screen.

**Architecture:** Extends the Teilprojekt-1 Supabase + vanilla-JS admin app. All point/timeout mutations funnel through three new Postgres RPCs (`record_point`, `undo_last_point`, `record_timeout`, plus `tag_last_point` for optional detail) that enforce the win conditions server-side; direct scorer writes to `sets`/`point_events` (allowed in Teilprojekt 1) are revoked. Cards/substitutions/incidents are simple scorer-owned tables with direct RLS (no state machine needed).

**Tech Stack:** Same as Teilprojekt 1 — Postgres/Supabase, Supabase CLI local dev stack, `@supabase/supabase-js`, `node --test`, Playwright, vanilla JS/HTML/CSS.

## Global Constraints

- No framework, no bundler — vanilla JS/HTML/CSS with native ES modules, same style as the existing admin screens.
- Every DB-sourced string interpolated into `innerHTML` MUST go through `escapeHtml()` from `admin/db.js` (established in Teilprojekt 1 after a stored-XSS finding).
- `admin/db.js` and any shared test files are appended to across tasks, never rewritten — earlier tasks' functions/tests must remain byte-for-byte intact.
- Win condition for a set: `(points >= 11 AND lead >= 2) OR (points >= 15)` — covers the regular 11-point rule and the 15:14 sudden-death hard cap in one formula.
- Admin is the only role that sets `matches.status = 'finished'` — unchanged from Teilprojekt 1. This plan does NOT add any automatic transition to `finished`.
- `players.team_id → teams(id) on delete cascade`; `player_events.player_id`, `substitutions.player_out_id`/`player_in_id` → `players(id) on delete restrict` (prevents silent loss of card/substitution history).
- Local dev DB accumulates fixtures across test runs (documented Teilprojekt-1 characteristic) — run `npx supabase db reset && node scripts/seed-roles.mjs` before a clean full-suite run if you hit unexplained duplicate-key errors.
- This Supabase project has `auto_expose_new_tables` off — every new table needs explicit `grant select/insert/update/delete ... to anon, authenticated` (or `service_role` for the migration's own test) in addition to RLS policies, or PostgREST rejects all access before RLS is even evaluated (learned the hard way in Teilprojekt 1 Tasks 2/3).

---

## File Structure

```
fistball-live/
  supabase/migrations/
    <ts>_sumula_schema.sql        (new — players, player_events, substitutions, match_incidents, sets timeout columns)
    <ts>_sumula_rls.sql           (new — RLS + grants for new tables, revokes old scorer sets/point_events policies)
    <ts>_record_point.sql         (new — record_point + tag_last_point RPCs)
    <ts>_undo_last_point.sql      (new — undo_last_point RPC)
    <ts>_record_timeout.sql       (new — record_timeout RPC)
  tests/
    schema-sumula.test.mjs        (new — FK integrity for the new tables)
    game-report-rls.test.mjs      (new — RLS/grant boundaries for the new tables + tightened sets/point_events access)
    game-report-rpc.test.mjs      (new — record_point/undo_last_point/record_timeout/tag_last_point behavior)
    e2e/
      game-report-flows.spec.mjs  (new — Playwright: roster, match selection+start, scoring, cards, substitutions, incidents)
  admin/
    db.js                         (modified — append players/game-report query + RPC functions)
    app.js                        (modified — add 'players' and 'game-report' nav items)
    index.html                    (modified — add script tags for the two new screens)
    screens/
      players.js                  (new — Kader CRUD, admin-facing)
      game-report.js              (new — the Game Report screen, built up across Tasks 7–11)
```

Rationale: `game-report.js` stays a single file across five tasks (7–11) because all its features (scoring, cards, substitutions, incidents) share the same in-memory "which match/set is currently selected" state — splitting them into separate files would mean threading that state across module boundaries for no isolation benefit, since a scorer only ever works one match at a time in one screen.

---

### Task 1: Roster and event schema

**Files:**
- Create: `supabase/migrations/<ts>_sumula_schema.sql` (use `npx supabase migration new sumula_schema`)
- Test: `tests/schema-sumula.test.mjs`

**Interfaces:**
- Consumes: `teams`, `matches`, `sets` tables from Teilprojekt 1.
- Produces: tables `players`, `player_events`, `substitutions`, `match_incidents`; columns `sets.timeouts_a`, `sets.timeouts_b` — every later task in this plan references these exact names.

- [ ] **Step 1: Start the local Supabase stack if not already running**

Run: `npx supabase status` (if it errors, run `npx supabase start` first). Ensure `.env` has `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_ADMIN_PASSWORD`, `SEED_SCORER_PASSWORD` (copy from `.env.example` and `npx supabase status -o env` if missing).

- [ ] **Step 2: Create the migration file**

Run: `npx supabase migration new sumula_schema`

- [ ] **Step 3: Write the schema**

Put this in `supabase/migrations/<timestamp>_sumula_schema.sql`:

```sql
create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  family_name text not null,
  given_name text not null,
  jersey_number integer,
  role text not null check (role in ('player', 'staff')),
  player_position text,
  staff_role text,
  created_at timestamptz not null default now()
);

create table player_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete restrict,
  event_type text not null check (event_type in ('Y', 'YR', 'R')),
  created_at timestamptz not null default now()
);

create table substitutions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  set_number integer not null,
  team_id uuid not null references teams(id) on delete restrict,
  player_out_id uuid not null references players(id) on delete restrict,
  player_in_id uuid not null references players(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table match_incidents (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  incident_type text not null check (incident_type in ('protest', 'referee_report', 'captain_time_violation', 'other')),
  team_id uuid references teams(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

alter table sets add column timeouts_a integer not null default 0;
alter table sets add column timeouts_b integer not null default 0;

grant select, insert, update, delete on public.players to service_role;
grant select, insert, update, delete on public.player_events to service_role;
grant select, insert, update, delete on public.substitutions to service_role;
grant select, insert, update, delete on public.match_incidents to service_role;
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db reset`

Expected: `Finished supabase db reset` with no errors.

- [ ] **Step 5: Write the failing test**

Create `tests/schema-sumula.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)');

const db = createClient(url, serviceKey);
let tournamentId, categoryId, teamId, matchId, playerId;

before(async () => {
  const t = await db.from('tournaments').insert({
    name: 'Sumula Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await db.from('categories').insert({
    tournament_id: tournamentId, name: 'Sumula Schema Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await db.from('teams').insert([
    { category_id: categoryId, name: 'Sumula Schema Team A' },
    { category_id: categoryId, name: 'Sumula Schema Team B' },
  ]).select();
  teamId = teams.data[0].id;
  const m = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teams.data[0].id, team_b_id: teams.data[1].id, sheet_match_nr: 999300,
  }).select().single();
  matchId = m.data.id;
});

after(async () => {
  await db.from('player_events').delete().eq('match_id', matchId);
  await db.from('players').delete().eq('team_id', teamId);
  await db.from('matches').delete().eq('id', matchId);
  await db.from('categories').delete().eq('id', categoryId);
  await db.from('tournaments').delete().eq('id', tournamentId);
});

test('a player can be created for a team and referenced by a player_event', async () => {
  const { data: player, error } = await db.from('players').insert({
    team_id: teamId, family_name: 'Muster', given_name: 'Max', jersey_number: 7, role: 'player', player_position: 'Spiker',
  }).select().single();
  assert.equal(error, null);
  playerId = player.id;

  const { data: event, error: eventError } = await db.from('player_events').insert({
    match_id: matchId, player_id: playerId, event_type: 'Y',
  }).select().single();
  assert.equal(eventError, null);
  assert.equal(event.event_type, 'Y');
});

test('a player_event cannot reference a non-existent player (FK enforced)', async () => {
  const { error } = await db.from('player_events').insert({
    match_id: matchId, player_id: '00000000-0000-0000-0000-000000000000', event_type: 'Y',
  });
  assert.ok(error, 'expected a foreign key violation error');
});

test('deleting a player referenced by a player_event is blocked', async () => {
  const { error } = await db.from('players').delete().eq('id', playerId);
  assert.ok(error, 'expected a foreign key violation error');
});

test('sets has timeouts_a/timeouts_b defaulting to 0', async () => {
  const { data: set, error } = await db.from('sets').insert({
    match_id: matchId, set_number: 1,
  }).select().single();
  assert.equal(error, null);
  assert.equal(set.timeouts_a, 0);
  assert.equal(set.timeouts_b, 0);
  await db.from('sets').delete().eq('id', set.id);
});
```

- [ ] **Step 6: Run the test**

Run: `set -a && source .env && set +a && node --test tests/schema-sumula.test.mjs`

Expected: `# pass 4`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/schema-sumula.test.mjs
git commit -m "feat: add roster, cards, substitutions, incidents schema"
```

---

### Task 2: RLS for new tables + tighten Teilprojekt-1 scorer access

**Files:**
- Create: `supabase/migrations/<ts>_sumula_rls.sql`
- Test: `tests/game-report-rls.test.mjs`

**Interfaces:**
- Consumes: `players`, `player_events`, `substitutions`, `match_incidents` from Task 1; `public.auth_role()` from Teilprojekt 1.
- Produces: RLS policies matching the spec's access rules; scorer's direct `sets`/`point_events` write access is removed (Tasks 3–5 restore point-mutation ability via RPCs only).

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new sumula_rls`

- [ ] **Step 2: Write the RLS policies**

Put this in `supabase/migrations/<timestamp>_sumula_rls.sql`:

```sql
alter table players enable row level security;
alter table player_events enable row level security;
alter table substitutions enable row level security;
alter table match_incidents enable row level security;

create policy "public read players" on players for select using (true);
create policy "public read player_events" on player_events for select using (true);
create policy "public read substitutions" on substitutions for select using (true);
create policy "public read match_incidents" on match_incidents for select using (true);

create policy "admin write players" on players for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

create policy "scorer write player_events" on player_events for all
  using (public.auth_role() = 'scorer') with check (public.auth_role() = 'scorer');
create policy "scorer write substitutions" on substitutions for all
  using (public.auth_role() = 'scorer') with check (public.auth_role() = 'scorer');
create policy "scorer write match_incidents" on match_incidents for all
  using (public.auth_role() = 'scorer') with check (public.auth_role() = 'scorer');

-- Base-table grants required alongside RLS — this Supabase project has
-- auto_expose_new_tables off (see Global Constraints).
grant select on players, player_events, substitutions, match_incidents to anon, authenticated;
grant insert, update, delete on players to authenticated;
grant insert, update, delete on player_events, substitutions, match_incidents to authenticated;

-- Tighten Teilprojekt 1: scorer no longer writes sets/point_events directly.
-- Tasks 3-5 add RPCs (record_point, undo_last_point, record_timeout) that
-- are the only way to mutate these tables from here on, so the rules they
-- enforce cannot be bypassed by a direct API call.
drop policy "scorer insert sets" on sets;
drop policy "scorer update sets" on sets;
drop policy "scorer insert point_events" on point_events;
drop policy "scorer update point_events" on point_events;
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Write the failing test**

Create `tests/game-report-rls.test.mjs`:

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
let tournamentId, categoryId, teamAId, teamBId, matchId, playerId;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Game Report RLS Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Game Report RLS Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Game Report RLS Team A' },
    { category_id: categoryId, name: 'Game Report RLS Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999301,
  }).select().single();
  matchId = m.data.id;
  const p = await service.from('players').insert({
    team_id: teamAId, family_name: 'Test', given_name: 'Player', jersey_number: 1, role: 'player',
  }).select().single();
  playerId = p.data.id;
});

after(async () => {
  await service.from('player_events').delete().eq('match_id', matchId);
  await service.from('substitutions').delete().eq('match_id', matchId);
  await service.from('match_incidents').delete().eq('match_id', matchId);
  await service.from('players').delete().eq('team_id', teamAId);
  await service.from('matches').delete().eq('id', matchId);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign-in failed for ${email}: ${error?.message}`);
  return client;
}

test('admin can insert a player, scorer cannot', async () => {
  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { data, error } = await admin.from('players')
    .insert({ team_id: teamAId, family_name: 'Admin', given_name: 'Added', role: 'player' }).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  await service.from('players').delete().eq('id', data[0].id);

  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { error: scorerError } = await scorer.from('players')
    .insert({ team_id: teamAId, family_name: 'Scorer', given_name: 'Added', role: 'player' });
  assert.ok(scorerError, 'scorer should not be able to insert players');
});

test('scorer can insert a player_event, admin cannot', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data, error } = await scorer.from('player_events')
    .insert({ match_id: matchId, player_id: playerId, event_type: 'Y' }).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  await service.from('player_events').delete().eq('id', data[0].id);

  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { error: adminError } = await admin.from('player_events')
    .insert({ match_id: matchId, player_id: playerId, event_type: 'Y' });
  assert.ok(adminError, 'admin should not be able to insert player_events');
});

test('scorer can insert a substitution and a match_incident', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data: player2 } = await service.from('players').insert({
    team_id: teamAId, family_name: 'Test2', given_name: 'Player2', jersey_number: 2, role: 'player',
  }).select().single();

  const sub = await scorer.from('substitutions').insert({
    match_id: matchId, set_number: 1, team_id: teamAId, player_out_id: playerId, player_in_id: player2.id,
  }).select();
  assert.equal(sub.error, null);
  assert.equal(sub.data.length, 1);

  const incident = await scorer.from('match_incidents').insert({
    match_id: matchId, incident_type: 'other', note: 'test',
  }).select();
  assert.equal(incident.error, null);
  assert.equal(incident.data.length, 1);

  await service.from('substitutions').delete().eq('id', sub.data[0].id);
  await service.from('match_incidents').delete().eq('id', incident.data[0].id);
  await service.from('players').delete().eq('id', player2.id);
});

test('anon can read players/player_events/substitutions/match_incidents', async () => {
  const anon = createClient(url, anonKey);
  const { data, error } = await anon.from('players').select().eq('id', playerId);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

test('scorer can no longer write sets/point_events directly', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { error } = await scorer.from('sets')
    .insert({ match_id: matchId, set_number: 999, points_a: 0, points_b: 0 });
  assert.ok(error, 'direct sets insert should now be rejected — only RPCs may write sets/point_events');
});
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && node --test tests/game-report-rls.test.mjs`

Expected: `# pass 5`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/game-report-rls.test.mjs
git commit -m "feat: add RLS for roster/cards/substitutions/incidents, tighten scorer access to sets"
```

---

### Task 3: `record_point` and `tag_last_point` RPCs

**Files:**
- Create: `supabase/migrations/<ts>_record_point.sql`
- Test: `tests/game-report-rpc.test.mjs`

**Interfaces:**
- Consumes: `matches`, `sets`, `point_events`, `public.auth_role()`.
- Produces: `record_point(p_match_id uuid, p_set_number integer, p_team text)` and `tag_last_point(p_match_id uuid, p_set_number integer, p_detail text)` RPCs — Task 8 (live-scoring UI) calls both by these exact names via `supabase.rpc(...)`.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new record_point`

- [ ] **Step 2: Write the RPCs**

Put this in `supabase/migrations/<timestamp>_record_point.sql`:

```sql
create or replace function public.record_point(p_match_id uuid, p_set_number integer, p_team text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_set sets%rowtype;
  v_new_a integer;
  v_new_b integer;
  v_team_id uuid;
begin
  if public.auth_role() not in ('admin', 'scorer') then
    raise exception 'not authorized';
  end if;
  if p_team not in ('a', 'b') then
    raise exception 'invalid team: %', p_team;
  end if;

  select * into v_match from matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'match is not live';
  end if;

  select * into v_set from sets where match_id = p_match_id and set_number = p_set_number;
  if v_set.id is null then
    insert into sets (match_id, set_number) values (p_match_id, p_set_number) returning * into v_set;
  end if;

  if v_set.winner_team_id is not null then
    raise exception 'set is already decided';
  end if;

  if p_team = 'a' then
    v_new_a := v_set.points_a + 1;
    v_new_b := v_set.points_b;
    v_team_id := v_match.team_a_id;
  else
    v_new_a := v_set.points_a;
    v_new_b := v_set.points_b + 1;
    v_team_id := v_match.team_b_id;
  end if;

  insert into point_events (set_id, team_id, event_type) values (v_set.id, v_team_id, 'point');

  update sets set
    points_a = v_new_a,
    points_b = v_new_b,
    winner_team_id = case
      when p_team = 'a' and (v_new_a >= 15 or (v_new_a >= 11 and v_new_a - v_new_b >= 2)) then v_match.team_a_id
      when p_team = 'b' and (v_new_b >= 15 or (v_new_b >= 11 and v_new_b - v_new_a >= 2)) then v_match.team_b_id
      else null
    end
  where id = v_set.id;
end;
$$;

revoke all on function public.record_point(uuid, integer, text) from public;
grant execute on function public.record_point(uuid, integer, text) to authenticated;

create or replace function public.tag_last_point(p_match_id uuid, p_set_number integer, p_detail text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_set sets%rowtype;
  v_last_event point_events%rowtype;
begin
  if public.auth_role() not in ('admin', 'scorer') then
    raise exception 'not authorized';
  end if;

  select * into v_match from matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'match is not live';
  end if;

  select * into v_set from sets where match_id = p_match_id and set_number = p_set_number;
  if v_set.id is null then
    raise exception 'set not found';
  end if;

  select * into v_last_event from point_events
    where set_id = v_set.id
    order by created_at desc limit 1;
  if v_last_event.id is null then
    raise exception 'no point to tag';
  end if;

  update point_events set event_type = p_detail where id = v_last_event.id;
end;
$$;

revoke all on function public.tag_last_point(uuid, integer, text) from public;
grant execute on function public.tag_last_point(uuid, integer, text) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Write the failing test**

Create `tests/game-report-rpc.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;
for (const [k, v] of Object.entries({ url, anonKey, serviceKey, scorerPassword })) {
  if (!v) throw new Error(`Missing env var for ${k} — see .env.example`);
}

const service = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, matchId, scorer;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Game Report RPC Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Game Report RPC Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Game Report RPC Team A' },
    { category_id: categoryId, name: 'Game Report RPC Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999302, status: 'live',
  }).select().single();
  matchId = m.data.id;

  scorer = createClient(url, anonKey);
  const { error } = await scorer.auth.signInWithPassword({
    email: 'scorer@fistball-ems.local', password: scorerPassword,
  });
  assert.equal(error, null, `scorer sign-in failed: ${error?.message}`);
});

after(async () => {
  const { data: setRows } = await service.from('sets').select('id').eq('match_id', matchId);
  const setIds = (setRows || []).map((s) => s.id);
  if (setIds.length) await service.from('point_events').delete().in('set_id', setIds);
  await service.from('sets').delete().eq('match_id', matchId);
  await service.from('matches').delete().eq('id', matchId);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

test('record_point accumulates and detects an 11-9 win', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 1, points_a: 10, points_b: 9 });
  const { error } = await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 1, p_team: 'a' });
  assert.equal(error, null);
  const { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 1).single();
  assert.equal(data.points_a, 11);
  assert.equal(data.points_b, 9);
  assert.equal(data.winner_team_id, teamAId);
});

test('record_point applies the 15:14 sudden-death cap', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 2, points_a: 14, points_b: 14 });
  const { error } = await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 2, p_team: 'b' });
  assert.equal(error, null);
  const { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 2).single();
  assert.equal(data.points_b, 15);
  assert.equal(data.winner_team_id, teamBId);
});

test('record_point rejects further scoring once a set is decided', async () => {
  await service.from('sets')
    .insert({ match_id: matchId, set_number: 3, points_a: 11, points_b: 5, winner_team_id: teamAId });
  const { error } = await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 3, p_team: 'b' });
  assert.ok(error, 'expected an error, the set is already decided');
});

test('record_point rejects scoring on a non-live match', async () => {
  const { data: scheduledMatch } = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999303,
  }).select().single();
  const { error } = await scorer.rpc('record_point', { p_match_id: scheduledMatch.id, p_set_number: 1, p_team: 'a' });
  assert.ok(error, 'expected an error, match is not live');
  await service.from('matches').delete().eq('id', scheduledMatch.id);
});

test('anon cannot call record_point', async () => {
  const anon = createClient(url, anonKey);
  const { error } = await anon.rpc('record_point', { p_match_id: matchId, p_set_number: 4, p_team: 'a' });
  assert.ok(error, 'expected anon to be rejected');
});

test('tag_last_point sets the event_type of the most recent point', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 5, points_a: 0, points_b: 0 });
  await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 5, p_team: 'a' });
  const { error } = await scorer.rpc('tag_last_point', { p_match_id: matchId, p_set_number: 5, p_detail: 'ace' });
  assert.equal(error, null);
  const { data: set } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 5).single();
  const { data: events } = await service.from('point_events').select()
    .eq('set_id', set.id).order('created_at', { ascending: false }).limit(1);
  assert.equal(events[0].event_type, 'ace');
});
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && node --test tests/game-report-rpc.test.mjs`

Expected: `# pass 6`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/game-report-rpc.test.mjs
git commit -m "feat: add record_point and tag_last_point RPCs with rule enforcement"
```

---

### Task 4: `undo_last_point` RPC

**Files:**
- Create: `supabase/migrations/<ts>_undo_last_point.sql`
- Modify: `tests/game-report-rpc.test.mjs` (append)

**Interfaces:**
- Consumes: same fixture (`teamAId`, `matchId`, `scorer` client) already set up in `tests/game-report-rpc.test.mjs`'s `before()` hook from Task 3 — do not duplicate the fixture, append tests inside the same file after the existing ones.
- Produces: `undo_last_point(p_match_id uuid, p_set_number integer)` RPC — Task 8 calls this by name.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new undo_last_point`

- [ ] **Step 2: Write the RPC**

Put this in `supabase/migrations/<timestamp>_undo_last_point.sql`:

```sql
create or replace function public.undo_last_point(p_match_id uuid, p_set_number integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_set sets%rowtype;
  v_last_event point_events%rowtype;
begin
  if public.auth_role() not in ('admin', 'scorer') then
    raise exception 'not authorized';
  end if;

  select * into v_match from matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'match is not live';
  end if;

  select * into v_set from sets where match_id = p_match_id and set_number = p_set_number;
  if v_set.id is null then
    raise exception 'set not found';
  end if;

  select * into v_last_event from point_events
    where set_id = v_set.id
    order by created_at desc limit 1;
  if v_last_event.id is null then
    raise exception 'nothing to undo';
  end if;

  delete from point_events where id = v_last_event.id;

  update sets set
    points_a = case when v_last_event.team_id = v_match.team_a_id then greatest(points_a - 1, 0) else points_a end,
    points_b = case when v_last_event.team_id = v_match.team_b_id then greatest(points_b - 1, 0) else points_b end,
    winner_team_id = null
  where id = v_set.id;
end;
$$;

revoke all on function public.undo_last_point(uuid, integer) from public;
grant execute on function public.undo_last_point(uuid, integer) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Append the failing tests**

Append to `tests/game-report-rpc.test.mjs` (after the `tag_last_point` test, still inside the same file — do not touch the `before`/`after` hooks or earlier tests):

```js
test('undo_last_point reverses the last point and clears winner_team_id', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 6, points_a: 10, points_b: 9 });
  await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 6, p_team: 'a' });
  let { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 6).single();
  assert.equal(data.points_a, 11);
  assert.equal(data.winner_team_id, teamAId);

  const { error } = await scorer.rpc('undo_last_point', { p_match_id: matchId, p_set_number: 6 });
  assert.equal(error, null);
  ({ data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 6).single());
  assert.equal(data.points_a, 10);
  assert.equal(data.winner_team_id, null);
});

test('undo_last_point can be called repeatedly', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 7, points_a: 0, points_b: 0 });
  await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 7, p_team: 'a' });
  await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 7, p_team: 'a' });
  await scorer.rpc('undo_last_point', { p_match_id: matchId, p_set_number: 7 });
  await scorer.rpc('undo_last_point', { p_match_id: matchId, p_set_number: 7 });
  const { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 7).single();
  assert.equal(data.points_a, 0);
});

test('undo_last_point errors when there is nothing to undo', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 8, points_a: 0, points_b: 0 });
  const { error } = await scorer.rpc('undo_last_point', { p_match_id: matchId, p_set_number: 8 });
  assert.ok(error, 'expected an error, nothing recorded yet for this set');
});
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && node --test tests/game-report-rpc.test.mjs`

Expected: `# pass 9`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/game-report-rpc.test.mjs
git commit -m "feat: add undo_last_point RPC, supports repeated undo"
```

---

### Task 5: `record_timeout` RPC

**Files:**
- Create: `supabase/migrations/<ts>_record_timeout.sql`
- Modify: `tests/game-report-rpc.test.mjs` (append)

**Interfaces:**
- Consumes: same fixture as Tasks 3–4 (append, don't duplicate).
- Produces: `record_timeout(p_match_id uuid, p_set_number integer, p_team text)` RPC — Task 8 calls this by name.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new record_timeout`

- [ ] **Step 2: Write the RPC**

Put this in `supabase/migrations/<timestamp>_record_timeout.sql`:

```sql
create or replace function public.record_timeout(p_match_id uuid, p_set_number integer, p_team text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_set sets%rowtype;
begin
  if public.auth_role() not in ('admin', 'scorer') then
    raise exception 'not authorized';
  end if;
  if p_team not in ('a', 'b') then
    raise exception 'invalid team: %', p_team;
  end if;

  select * into v_match from matches where id = p_match_id;
  if v_match.id is null then
    raise exception 'match not found';
  end if;
  if v_match.status <> 'live' then
    raise exception 'match is not live';
  end if;

  select * into v_set from sets where match_id = p_match_id and set_number = p_set_number;
  if v_set.id is null then
    insert into sets (match_id, set_number) values (p_match_id, p_set_number) returning * into v_set;
  end if;

  update sets set
    timeouts_a = case when p_team = 'a' then timeouts_a + 1 else timeouts_a end,
    timeouts_b = case when p_team = 'b' then timeouts_b + 1 else timeouts_b end
  where id = v_set.id;
end;
$$;

revoke all on function public.record_timeout(uuid, integer, text) from public;
grant execute on function public.record_timeout(uuid, integer, text) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 4: Append the failing tests**

Append to `tests/game-report-rpc.test.mjs`:

```js
test('record_timeout increments the counter for the given team', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 9, points_a: 0, points_b: 0 });
  await scorer.rpc('record_timeout', { p_match_id: matchId, p_set_number: 9, p_team: 'a' });
  await scorer.rpc('record_timeout', { p_match_id: matchId, p_set_number: 9, p_team: 'a' });
  await scorer.rpc('record_timeout', { p_match_id: matchId, p_set_number: 9, p_team: 'b' });
  const { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 9).single();
  assert.equal(data.timeouts_a, 2);
  assert.equal(data.timeouts_b, 1);
});

test('record_timeout is rejected for a non-live match', async () => {
  const { data: scheduledMatch } = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999304,
  }).select().single();
  const { error } = await scorer.rpc('record_timeout', { p_match_id: scheduledMatch.id, p_set_number: 1, p_team: 'a' });
  assert.ok(error, 'expected an error, match is not live');
  await service.from('matches').delete().eq('id', scheduledMatch.id);
});
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && node --test tests/game-report-rpc.test.mjs`

Expected: `# pass 11`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/game-report-rpc.test.mjs
git commit -m "feat: add record_timeout RPC"
```

---

### Task 6: Kader (roster) admin screen

**Files:**
- Modify: `admin/db.js` (append)
- Modify: `admin/app.js:12-19` (add `['players', 'Kader']` to the `items` array in `renderNav`)
- Modify: `admin/index.html:32` (add `<script type="module" src="screens/players.js"></script>` after the `matches.js` line)
- Create: `admin/screens/players.js`
- Create: `tests/e2e/game-report-flows.spec.mjs`

**Interfaces:**
- Consumes: `listTournaments`, `listCategories`, `listTeams`, `escapeHtml` from `admin/db.js` (Teilprojekt 1); `registerScreen` from `admin/app.js`.
- Produces: `listPlayers(teamId)`, `createPlayer(data)`, `deletePlayer(id)` in `admin/db.js` — Tasks 9–10 use `listPlayers` for card/substitution player pickers. `registerScreen('players', ...)`.

- [ ] **Step 1: Write the failing Playwright test**

Create `tests/e2e/game-report-flows.spec.mjs`:

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

test('admin can set up a tournament and add a player to the roster', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Game Report Test Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Game Report Test Tournament');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Game Report Test Tournament' });
  await page.fill('#c_name', 'Game Report Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#team_category', { label: 'Game Report Category' });
  await page.fill('#team_name', 'Game Report Team A');
  await page.click('#teamForm button[type=submit]');
  await page.fill('#team_name', 'Game Report Team B');
  await page.click('#teamForm button[type=submit]');

  await page.click('button[data-screen=players]');
  await page.selectOption('#player_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#player_category', { label: 'Game Report Category' });
  await page.selectOption('#player_team', { label: 'Game Report Team A' });
  await page.fill('#player_family_name', 'Mustermann');
  await page.fill('#player_given_name', 'Max');
  await page.fill('#player_jersey_number', '7');
  await page.click('#playerForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Max Mustermann');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs`

Expected: FAIL — `button[data-screen=players]` has no matching element yet.

- [ ] **Step 3: Append functions to `admin/db.js`**

```js
export async function listPlayers(teamId) {
  const { data, error } = await getClient().from('players').select().eq('team_id', teamId).order('jersey_number');
  if (error) throw error;
  return data;
}

export async function createPlayer({ team_id, family_name, given_name, jersey_number, role, player_position, staff_role }) {
  const { error } = await getClient().from('players').insert({
    team_id, family_name, given_name,
    jersey_number: jersey_number || null,
    role,
    player_position: player_position || null,
    staff_role: staff_role || null,
  });
  if (error) throw error;
}

export async function deletePlayer(id) {
  const { error } = await getClient().from('players').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Write `admin/screens/players.js`**

```js
import { registerScreen } from '../app.js';
import { escapeHtml, listTournaments, listCategories, listTeams, listPlayers, createPlayer, deletePlayer } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Kader</h2>
    <label>Turnier<select id="player_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="player_category"></select></label>
    <label>Team<select id="player_team"></select></label>
    <div id="playerTableWrap"></div>
    <form id="playerForm" class="entity-form">
      <label>Nachname<input id="player_family_name" required></label>
      <label>Vorname<input id="player_given_name" required></label>
      <label>Rolle
        <select id="player_role">
          <option value="player">Spieler</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      <label>Rückennummer<input id="player_jersey_number" type="number"></label>
      <label>Position (Spieler)<input id="player_position"></label>
      <label>Staff-Rolle<input id="player_staff_role"></label>
      <button type="submit">Anlegen</button>
      <p id="playerError" class="error" hidden></p>
    </form>
  `;

  let currentTeamId = null;

  async function renderTable() {
    const players = currentTeamId ? await listPlayers(currentTeamId) : [];
    document.getElementById('playerTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Nr</th><th>Name</th><th>Rolle</th><th>Position/Staff-Rolle</th><th></th></tr></thead>
        <tbody>${players.map((p) => `
          <tr>
            <td>${p.jersey_number ?? ''}</td>
            <td>${escapeHtml(p.given_name)} ${escapeHtml(p.family_name)}</td>
            <td>${p.role === 'player' ? 'Spieler' : 'Staff'}</td>
            <td>${escapeHtml(p.player_position || p.staff_role || '')}</td>
            <td><button data-delete="${p.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('playerError');
        try {
          await deletePlayer(btn.dataset.delete);
          await renderTable();
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Karten/Wechseln verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('player_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshTeams(categoryId) {
    const teams = await listTeams(categoryId);
    document.getElementById('player_team').innerHTML =
      teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    return teams;
  }

  async function selectFirstTeamAndRender(categoryId) {
    const teams = await refreshTeams(categoryId);
    currentTeamId = teams[0]?.id || null;
    await renderTable();
  }

  document.getElementById('player_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) await selectFirstTeamAndRender(categories[0].id);
  };
  document.getElementById('player_category').onchange = async (e) => {
    await selectFirstTeamAndRender(e.target.value);
  };
  document.getElementById('player_team').onchange = async (e) => {
    currentTeamId = e.target.value;
    await renderTable();
  };

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) await selectFirstTeamAndRender(categories[0].id);
  }

  document.getElementById('playerForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('playerError');
    try {
      await createPlayer({
        team_id: currentTeamId,
        family_name: document.getElementById('player_family_name').value.trim(),
        given_name: document.getElementById('player_given_name').value.trim(),
        jersey_number: document.getElementById('player_jersey_number').value || null,
        role: document.getElementById('player_role').value,
        player_position: document.getElementById('player_position').value.trim(),
        staff_role: document.getElementById('player_staff_role').value.trim(),
      });
      await renderTable();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('players', { render });
```

- [ ] **Step 5: Add the nav item**

In `admin/app.js`, find the `items` array inside `renderNav()`:

```js
  const items = [
    ['tournaments', 'Turnier'],
    ['categories', 'Kategorien'],
    ['courts', 'Courts'],
    ['teams', 'Teams'],
    ['matches', 'Matches'],
  ];
```

Change it to:

```js
  const items = [
    ['tournaments', 'Turnier'],
    ['categories', 'Kategorien'],
    ['courts', 'Courts'],
    ['teams', 'Teams'],
    ['players', 'Kader'],
    ['matches', 'Matches'],
    ['game-report', 'Game Report'],
  ];
```

(This also adds the `game-report` nav entry now so Task 7 doesn't need to touch `app.js` again — the screen itself doesn't exist until Task 7 registers it, so clicking it before Task 7 is done would error, which is expected mid-plan, not a bug.)

- [ ] **Step 6: Add the script tag**

In `admin/index.html`, after the `matches.js` line, add:

```html
  <script type="module" src="screens/players.js"></script>
  <script type="module" src="screens/game-report.js"></script>
```

(Both lines now, for the same reason as Step 5 — `game-report.js` doesn't exist until Task 7, so this file will 404 in the browser console until then; harmless, matches the established pattern from Teilprojekt 1 Task 7.)

- [ ] **Step 7: Run the test**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs`

Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add admin/db.js admin/app.js admin/index.html admin/screens/players.js tests/e2e/game-report-flows.spec.mjs
git commit -m "feat: add Kader (roster) admin screen"
```

---

### Task 7: Game Report screen — match selection, header, start match

**Files:**
- Modify: `admin/db.js` (append)
- Create: `admin/screens/game-report.js`
- Modify: `tests/e2e/game-report-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `listTournaments`, `listCategories`, `listMatches`, `startMatch`, `escapeHtml` from `admin/db.js` (Teilprojekt 1); `registerScreen` from `admin/app.js`.
- Produces: `getMatch(matchId)`, `listRefereeAssignments(matchId)` in `admin/db.js`. `registerScreen('game-report', ...)`. Module-level `currentMatchId` in `game-report.js` (not exported — Task 8 adds to the same file and reads/writes this same variable).

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/game-report-flows.spec.mjs`:

```js
test('admin can select a match in Game Report and start it', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#match_category', { label: 'Game Report Category' });
  await page.selectOption('#match_team_a', { label: 'Game Report Team A' });
  await page.selectOption('#match_team_b', { label: 'Game Report Team B' });
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Game Report Team A');

  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });
  await expect(page.locator('#gameReportHeader')).toContainText('Game Report Team A');
  await expect(page.locator('#gameReportHeader')).toContainText('scheduled');

  await page.click('#startMatchBtn');
  await expect(page.locator('#gameReportHeader')).toContainText('live');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "select a match"`

Expected: FAIL — no `game-report` screen registered yet.

- [ ] **Step 3: Append functions to `admin/db.js`**

```js
export async function getMatch(matchId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, status, best_of, round_label, team_a_id, team_b_id, team_a:team_a_id(id, name), team_b:team_b_id(id, name), court:court_id(name)')
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data;
}

export async function listRefereeAssignments(matchId) {
  const { data, error } = await getClient()
    .from('referee_assignments')
    .select('referee_name, role')
    .eq('match_id', matchId);
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Write `admin/screens/game-report.js`**

```js
import { registerScreen } from '../app.js';
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
} from '../db.js';

let currentMatchId = null;

async function renderHeader(match) {
  const referees = await listRefereeAssignments(match.id);
  const refereeList = referees.length
    ? referees.map((r) => `${escapeHtml(r.role)}: ${escapeHtml(r.referee_name)}`).join(', ')
    : '—';
  const headerWrap = document.getElementById('gameReportHeader');
  headerWrap.innerHTML = `
    <h3>${escapeHtml(match.team_a.name)} vs. ${escapeHtml(match.team_b.name)}</h3>
    <p>Court: ${escapeHtml(match.court?.name || '—')} · Best of ${match.best_of} · Status: ${escapeHtml(match.status)}</p>
    <p>Schiedsrichter: ${refereeList}</p>
    ${match.status === 'scheduled' ? '<button id="startMatchBtn">Match starten</button>' : ''}
    <p id="gameReportError" class="error" hidden></p>
    <div id="gameReportBody"></div>
  `;
  if (match.status === 'scheduled') {
    document.getElementById('startMatchBtn').onclick = async () => {
      const errorEl = document.getElementById('gameReportError');
      try {
        await startMatch(match.id);
        await selectMatch(match.id);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    };
  }
}

async function selectMatch(matchId) {
  currentMatchId = matchId;
  const match = await getMatch(matchId);
  await renderHeader(match);
}

async function render(main) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Game Report</h2>
    <label>Turnier<select id="gr_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="gr_category"></select></label>
    <label>Match<select id="gr_match"></select></label>
    <div id="gameReportHeader"></div>
  `;

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('gr_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshMatches(categoryId) {
    const matches = await listMatches(categoryId);
    const open = matches.filter((m) => m.status === 'scheduled' || m.status === 'live');
    document.getElementById('gr_match').innerHTML = open.map((m) =>
      `<option value="${m.id}">${escapeHtml(m.team_a.name)} vs. ${escapeHtml(m.team_b.name)} (${escapeHtml(m.status)})</option>`
    ).join('');
    return open;
  }

  document.getElementById('gr_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) {
      const matches = await refreshMatches(categories[0].id);
      if (matches[0]) await selectMatch(matches[0].id);
    }
  };
  document.getElementById('gr_category').onchange = async (e) => {
    const matches = await refreshMatches(e.target.value);
    if (matches[0]) await selectMatch(matches[0].id);
  };
  document.getElementById('gr_match').onchange = async (e) => {
    await selectMatch(e.target.value);
  };

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) {
      const matches = await refreshMatches(categories[0].id);
      if (matches[0]) await selectMatch(matches[0].id);
    }
  }
}

registerScreen('game-report', { render });
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "select a match"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/game-report.js tests/e2e/game-report-flows.spec.mjs
git commit -m "feat: add Game Report match selection, header, and start-match action"
```

---

### Task 8: Game Report — live scoring (points, undo, timeouts, detail tag)

**Files:**
- Modify: `admin/db.js` (append)
- Modify: `admin/screens/game-report.js` (extend `renderHeader`/`selectMatch`, add scoring UI)
- Modify: `tests/e2e/game-report-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `currentMatchId` (module-level variable from Task 7, same file). `record_point`/`undo_last_point`/`record_timeout`/`tag_last_point` RPCs from Tasks 3–5.
- Produces: `listSets(matchId)`, `recordPoint(matchId, setNumber, team)`, `undoLastPoint(matchId, setNumber)`, `recordTimeout(matchId, setNumber, team)`, `tagLastPoint(matchId, setNumber, detail)` in `admin/db.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/game-report-flows.spec.mjs`:

```js
test('scorer can record points, tag a detail, use undo, and record a timeout', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });
  await expect(page.locator('#gameReportHeader')).toContainText('live');

  await page.click('#pointA');
  await page.click('#pointA');
  await expect(page.locator('#gr_score_a')).toHaveText('2');

  await page.click('#tagAceBtn');

  await page.click('#undoBtn');
  await expect(page.locator('#gr_score_a')).toHaveText('1');

  await page.click('#timeoutA');
  await expect(page.locator('#gr_timeouts_a')).toHaveText('1');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "record points"`

Expected: FAIL — `#pointA` doesn't exist yet.

- [ ] **Step 3: Append functions to `admin/db.js`**

```js
export async function listSets(matchId) {
  const { data, error } = await getClient().from('sets').select().eq('match_id', matchId).order('set_number');
  if (error) throw error;
  return data;
}

export async function recordPoint(matchId, setNumber, team) {
  const { error } = await getClient().rpc('record_point', { p_match_id: matchId, p_set_number: setNumber, p_team: team });
  if (error) throw error;
}

export async function undoLastPoint(matchId, setNumber) {
  const { error } = await getClient().rpc('undo_last_point', { p_match_id: matchId, p_set_number: setNumber });
  if (error) throw error;
}

export async function recordTimeout(matchId, setNumber, team) {
  const { error } = await getClient().rpc('record_timeout', { p_match_id: matchId, p_set_number: setNumber, p_team: team });
  if (error) throw error;
}

export async function tagLastPoint(matchId, setNumber, detail) {
  const { error } = await getClient().rpc('tag_last_point', { p_match_id: matchId, p_set_number: setNumber, p_detail: detail });
  if (error) throw error;
}
```

- [ ] **Step 4: Extend `admin/screens/game-report.js`**

Add this helper function near the top of the file (after the imports, before `renderHeader`) — it returns the lowest set number that either doesn't exist yet or exists without a `winner_team_id`, i.e. the set currently being played:

```js
function currentSetNumber(sets) {
  for (let n = 1; n <= 99; n++) {
    const set = sets.find((s) => s.set_number === n);
    if (!set || !set.winner_team_id) return n;
  }
  return 1;
}
```

Update the import line to add the new `db.js` functions:

```js
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
  listSets, recordPoint, undoLastPoint, recordTimeout, tagLastPoint,
} from '../db.js';
```

Replace the `renderHeader` function with this version (adds the live-scoring body when the match is `live`):

```js
async function renderHeader(match) {
  const referees = await listRefereeAssignments(match.id);
  const refereeList = referees.length
    ? referees.map((r) => `${escapeHtml(r.role)}: ${escapeHtml(r.referee_name)}`).join(', ')
    : '—';
  const headerWrap = document.getElementById('gameReportHeader');
  headerWrap.innerHTML = `
    <h3>${escapeHtml(match.team_a.name)} vs. ${escapeHtml(match.team_b.name)}</h3>
    <p>Court: ${escapeHtml(match.court?.name || '—')} · Best of ${match.best_of} · Status: ${escapeHtml(match.status)}</p>
    <p>Schiedsrichter: ${refereeList}</p>
    ${match.status === 'scheduled' ? '<button id="startMatchBtn">Match starten</button>' : ''}
    <p id="gameReportError" class="error" hidden></p>
    <div id="gameReportBody"></div>
  `;
  if (match.status === 'scheduled') {
    document.getElementById('startMatchBtn').onclick = async () => {
      const errorEl = document.getElementById('gameReportError');
      try {
        await startMatch(match.id);
        await selectMatch(match.id);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    };
  }
  if (match.status === 'live') {
    await renderScoringBody(match);
  }
}

async function renderScoringBody(match) {
  const sets = await listSets(match.id);
  const setNumber = currentSetNumber(sets);
  const current = sets.find((s) => s.set_number === setNumber) || { points_a: 0, points_b: 0, timeouts_a: 0, timeouts_b: 0 };

  const body = document.getElementById('gameReportBody');
  body.innerHTML = `
    <h4>Satz ${setNumber}</h4>
    <div class="gr-score">
      <div>
        <span>${escapeHtml(match.team_a.name)}: <span id="gr_score_a">${current.points_a}</span></span>
        <button id="pointA">+1 ${escapeHtml(match.team_a.name)}</button>
        <button id="timeoutA">Timeout</button>
        <span>Timeouts: <span id="gr_timeouts_a">${current.timeouts_a}</span></span>
      </div>
      <div>
        <span>${escapeHtml(match.team_b.name)}: <span id="gr_score_b">${current.points_b}</span></span>
        <button id="pointB">+1 ${escapeHtml(match.team_b.name)}</button>
        <button id="timeoutB">Timeout</button>
        <span>Timeouts: <span id="gr_timeouts_b">${current.timeouts_b}</span></span>
      </div>
    </div>
    <button id="undoBtn">Rückgängig</button>
    <span id="gr_tag_hint">Letzter Punkt: <button id="tagAceBtn">Ass</button><button id="tagFaultBtn">Aufschlagfehler</button></span>
    <div id="gr_sets_summary">
      ${sets.map((s) => `<span>Satz ${s.set_number}: ${s.points_a}:${s.points_b}${s.winner_team_id ? ' ✓' : ''}</span>`).join(' · ')}
    </div>
  `;

  const errorEl = document.getElementById('gameReportError');
  const withErrorHandling = (fn) => async () => {
    try {
      await fn();
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  document.getElementById('pointA').onclick = withErrorHandling(() => recordPoint(match.id, setNumber, 'a'));
  document.getElementById('pointB').onclick = withErrorHandling(() => recordPoint(match.id, setNumber, 'b'));
  document.getElementById('timeoutA').onclick = withErrorHandling(() => recordTimeout(match.id, setNumber, 'a'));
  document.getElementById('timeoutB').onclick = withErrorHandling(() => recordTimeout(match.id, setNumber, 'b'));
  document.getElementById('undoBtn').onclick = withErrorHandling(() => undoLastPoint(match.id, setNumber));
  document.getElementById('tagAceBtn').onclick = withErrorHandling(() => tagLastPoint(match.id, setNumber, 'ace'));
  document.getElementById('tagFaultBtn').onclick = withErrorHandling(() => tagLastPoint(match.id, setNumber, 'service_fault'));
}
```

Note: `selectMatch` (from Task 7) already re-fetches the match and re-renders the header on every action, so after any button click the scoring body re-renders with fresh data from the server — no manual DOM patching needed, and no optimistic updates (matches the spec's error-handling requirement).

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "record points"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/game-report.js tests/e2e/game-report-flows.spec.mjs
git commit -m "feat: add live point/undo/timeout/tag scoring to Game Report"
```

---

### Task 9: Game Report — cards

**Files:**
- Modify: `admin/db.js` (append)
- Modify: `admin/screens/game-report.js` (extend `renderScoringBody` or add a sibling section)
- Modify: `tests/e2e/game-report-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `currentMatchId`, `match.team_a_id`/`team_b_id` from the already-loaded match object; `listPlayers` from `admin/db.js` (Task 6).
- Produces: `createPlayerEvent(data)`, `listPlayerEvents(matchId)` in `admin/db.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/game-report-flows.spec.mjs`:

```js
test('scorer can record a card for a player', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });

  await page.selectOption('#card_player', { label: /Max Mustermann/ });
  await page.selectOption('#card_type', 'Y');
  await page.click('#cardForm button[type=submit]');
  await expect(page.locator('#gr_cards_list')).toContainText('Max Mustermann');
  await expect(page.locator('#gr_cards_list')).toContainText('Y');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "record a card"`

Expected: FAIL — `#card_player` doesn't exist yet.

- [ ] **Step 3: Append functions to `admin/db.js`**

```js
export async function createPlayerEvent({ match_id, player_id, event_type }) {
  const { error } = await getClient().from('player_events').insert({ match_id, player_id, event_type });
  if (error) throw error;
}

export async function listPlayerEvents(matchId) {
  const { data, error } = await getClient()
    .from('player_events')
    .select('id, event_type, created_at, player:player_id(family_name, given_name, jersey_number)')
    .eq('match_id', matchId)
    .order('created_at');
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Extend `admin/screens/game-report.js`**

Update the import line again:

```js
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
  listSets, recordPoint, undoLastPoint, recordTimeout, tagLastPoint,
  listPlayers, createPlayerEvent, listPlayerEvents,
} from '../db.js';
```

Add a new function `renderCardsSection` and call it from `renderScoringBody` (append the call at the very end of `renderScoringBody`, after the existing button-wiring code, and append the function itself after `renderScoringBody`):

```js
async function renderCardsSection(match) {
  const [playersA, playersB, events] = await Promise.all([
    listPlayers(match.team_a_id),
    listPlayers(match.team_b_id),
    listPlayerEvents(match.id),
  ]);
  const players = [...playersA, ...playersB].filter((p) => p.role === 'player');
  const playerOptions = players.map((p) =>
    `<option value="${p.id}">${escapeHtml(p.given_name)} ${escapeHtml(p.family_name)} (#${p.jersey_number ?? '-'})</option>`
  ).join('');

  const body = document.getElementById('gameReportBody');
  body.insertAdjacentHTML('beforeend', `
    <h4>Karten</h4>
    <div id="gr_cards_list">
      ${events.map((e) =>
        `<div>${escapeHtml(e.player.given_name)} ${escapeHtml(e.player.family_name)}: ${escapeHtml(e.event_type)}</div>`
      ).join('')}
    </div>
    <form id="cardForm" class="entity-form">
      <label>Spieler<select id="card_player">${playerOptions}</select></label>
      <label>Karte
        <select id="card_type">
          <option value="Y">Gelb</option>
          <option value="YR">Gelb-Rot</option>
          <option value="R">Rot</option>
        </select>
      </label>
      <button type="submit">Erfassen</button>
    </form>
  `);

  document.getElementById('cardForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('gameReportError');
    try {
      await createPlayerEvent({
        match_id: match.id,
        player_id: document.getElementById('card_player').value,
        event_type: document.getElementById('card_type').value,
      });
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}
```

At the end of `renderScoringBody`, after the `tagFaultBtn` wiring line, add:

```js
  await renderCardsSection(match);
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "record a card"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/game-report.js tests/e2e/game-report-flows.spec.mjs
git commit -m "feat: add card recording to Game Report"
```

---

### Task 10: Game Report — substitutions

**Files:**
- Modify: `admin/db.js` (append)
- Modify: `admin/screens/game-report.js` (extend)
- Modify: `tests/e2e/game-report-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: `match.team_a_id`, `listPlayers` (already imported from Task 9).
- Produces: `createSubstitution(data)`, `listSubstitutions(matchId)` in `admin/db.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/game-report-flows.spec.mjs`:

```js
test('scorer can record a substitution', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=players]');
  await page.selectOption('#player_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#player_category', { label: 'Game Report Category' });
  await page.selectOption('#player_team', { label: 'Game Report Team A' });
  await page.fill('#player_family_name', 'Ersatz');
  await page.fill('#player_given_name', 'Erik');
  await page.fill('#player_jersey_number', '12');
  await page.click('#playerForm button[type=submit]');
  await page.click('#logoutBtn');

  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });

  await page.selectOption('#sub_player_out', { label: /Max Mustermann/ });
  await page.selectOption('#sub_player_in', { label: /Erik Ersatz/ });
  await page.click('#subForm button[type=submit]');
  await expect(page.locator('#gr_subs_list')).toContainText('Max Mustermann');
  await expect(page.locator('#gr_subs_list')).toContainText('Erik Ersatz');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "record a substitution"`

Expected: FAIL — `#sub_player_out` doesn't exist yet.

- [ ] **Step 3: Append functions to `admin/db.js`**

```js
export async function createSubstitution({ match_id, set_number, team_id, player_out_id, player_in_id }) {
  const { error } = await getClient().from('substitutions').insert({ match_id, set_number, team_id, player_out_id, player_in_id });
  if (error) throw error;
}

export async function listSubstitutions(matchId) {
  const { data, error } = await getClient()
    .from('substitutions')
    .select('id, set_number, created_at, player_out:player_out_id(family_name, given_name), player_in:player_in_id(family_name, given_name)')
    .eq('match_id', matchId)
    .order('created_at');
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Extend `admin/screens/game-report.js`**

Update the import line:

```js
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
  listSets, recordPoint, undoLastPoint, recordTimeout, tagLastPoint,
  listPlayers, createPlayerEvent, listPlayerEvents,
  createSubstitution, listSubstitutions,
} from '../db.js';
```

Add `renderSubstitutionsSection`, called from `renderScoringBody` right after the `renderCardsSection(match)` call:

```js
async function renderSubstitutionsSection(match, setNumber) {
  const [playersA, playersB, subs] = await Promise.all([
    listPlayers(match.team_a_id),
    listPlayers(match.team_b_id),
    listSubstitutions(match.id),
  ]);
  const players = [...playersA, ...playersB].filter((p) => p.role === 'player');
  const playerOptions = players.map((p) =>
    `<option value="${p.id}" data-team="${playersA.includes(p) ? match.team_a_id : match.team_b_id}">${escapeHtml(p.given_name)} ${escapeHtml(p.family_name)}</option>`
  ).join('');

  const body = document.getElementById('gameReportBody');
  body.insertAdjacentHTML('beforeend', `
    <h4>Auswechslungen</h4>
    <div id="gr_subs_list">
      ${subs.map((s) =>
        `<div>Satz ${s.set_number}: ${escapeHtml(s.player_out.given_name)} ${escapeHtml(s.player_out.family_name)} → ${escapeHtml(s.player_in.given_name)} ${escapeHtml(s.player_in.family_name)}</div>`
      ).join('')}
    </div>
    <form id="subForm" class="entity-form">
      <label>Spieler raus<select id="sub_player_out">${playerOptions}</select></label>
      <label>Spieler rein<select id="sub_player_in">${playerOptions}</select></label>
      <button type="submit">Erfassen</button>
    </form>
  `);

  document.getElementById('subForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('gameReportError');
    try {
      const outSelect = document.getElementById('sub_player_out');
      const teamId = outSelect.selectedOptions[0].dataset.team;
      await createSubstitution({
        match_id: match.id,
        set_number: setNumber,
        team_id: teamId,
        player_out_id: outSelect.value,
        player_in_id: document.getElementById('sub_player_in').value,
      });
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}
```

In `renderScoringBody`, after the `await renderCardsSection(match);` line, add:

```js
  await renderSubstitutionsSection(match, setNumber);
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "record a substitution"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/game-report.js tests/e2e/game-report-flows.spec.mjs
git commit -m "feat: add substitution recording to Game Report"
```

---

### Task 11: Game Report — extraordinary events + match-status banner

**Files:**
- Modify: `admin/db.js` (append)
- Modify: `admin/screens/game-report.js` (extend)
- Modify: `tests/e2e/game-report-flows.spec.mjs` (append)

**Interfaces:**
- Consumes: everything already imported in `game-report.js`.
- Produces: `createMatchIncident(data)`, `listMatchIncidents(matchId)` in `admin/db.js`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/game-report-flows.spec.mjs`:

```js
test('scorer can record an extraordinary event, and the decided-match banner appears', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });

  await page.selectOption('#incident_type', 'other');
  await page.fill('#incident_note', 'Regenunterbrechung 5 Minuten');
  await page.click('#incidentForm button[type=submit]');
  await expect(page.locator('#gr_incidents_list')).toContainText('Regenunterbrechung');

  // Drive the current set to a decided 11-0 to make the banner appear.
  for (let i = 0; i < 11; i++) {
    await page.click('#pointA');
  }
  await expect(page.locator('#gr_decided_banner')).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "extraordinary event"`

Expected: FAIL — `#incident_type` doesn't exist yet.

- [ ] **Step 3: Append functions to `admin/db.js`**

```js
export async function createMatchIncident({ match_id, incident_type, team_id, note }) {
  const { error } = await getClient().from('match_incidents').insert({
    match_id, incident_type, team_id: team_id || null, note: note || null,
  });
  if (error) throw error;
}

export async function listMatchIncidents(matchId) {
  const { data, error } = await getClient().from('match_incidents').select().eq('match_id', matchId).order('created_at');
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Extend `admin/screens/game-report.js`**

Update the import line:

```js
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
  listSets, recordPoint, undoLastPoint, recordTimeout, tagLastPoint,
  listPlayers, createPlayerEvent, listPlayerEvents,
  createSubstitution, listSubstitutions,
  createMatchIncident, listMatchIncidents,
} from '../db.js';
```

Add a `setsWonPerTeam` helper and `renderIncidentsSection` + banner logic. Add this helper function next to `currentSetNumber`:

```js
function setsWonPerTeam(sets, match) {
  let wonA = 0, wonB = 0;
  for (const s of sets) {
    if (s.winner_team_id === match.team_a_id) wonA++;
    if (s.winner_team_id === match.team_b_id) wonB++;
  }
  return { wonA, wonB };
}
```

Add `renderIncidentsSection`:

```js
async function renderIncidentsSection(match) {
  const incidents = await listMatchIncidents(match.id);
  const body = document.getElementById('gameReportBody');
  body.insertAdjacentHTML('beforeend', `
    <h4>Sonstiges</h4>
    <div id="gr_incidents_list">
      ${incidents.map((i) => `<div>${escapeHtml(i.incident_type)}${i.note ? ': ' + escapeHtml(i.note) : ''}</div>`).join('')}
    </div>
    <form id="incidentForm" class="entity-form">
      <label>Typ
        <select id="incident_type">
          <option value="protest">Protest</option>
          <option value="referee_report">Schiedsrichterbericht</option>
          <option value="captain_time_violation">Zeitstrafe Kapitän</option>
          <option value="other">Sonstiges</option>
        </select>
      </label>
      <label>Notiz<input id="incident_note"></label>
      <button type="submit">Erfassen</button>
    </form>
  `);

  document.getElementById('incidentForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('gameReportError');
    try {
      await createMatchIncident({
        match_id: match.id,
        incident_type: document.getElementById('incident_type').value,
        note: document.getElementById('incident_note').value.trim(),
      });
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}
```

In `renderScoringBody`, right after computing `sets` and `setNumber` (before building the `body.innerHTML` template), add the decided-match banner into the template. Change the start of `renderScoringBody` from:

```js
async function renderScoringBody(match) {
  const sets = await listSets(match.id);
  const setNumber = currentSetNumber(sets);
  const current = sets.find((s) => s.set_number === setNumber) || { points_a: 0, points_b: 0, timeouts_a: 0, timeouts_b: 0 };

  const body = document.getElementById('gameReportBody');
  body.innerHTML = `
    <h4>Satz ${setNumber}</h4>
```

to:

```js
async function renderScoringBody(match) {
  const sets = await listSets(match.id);
  const setNumber = currentSetNumber(sets);
  const current = sets.find((s) => s.set_number === setNumber) || { points_a: 0, points_b: 0, timeouts_a: 0, timeouts_b: 0 };
  const { wonA, wonB } = setsWonPerTeam(sets, match);
  const neededSets = Math.ceil(match.best_of / 2);
  const decided = wonA >= neededSets || wonB >= neededSets;

  const body = document.getElementById('gameReportBody');
  body.innerHTML = `
    ${decided ? `<p id="gr_decided_banner">Match entschieden (${wonA}:${wonB}) — wartet auf Freigabe durch Admin</p>` : ''}
    <h4>Satz ${setNumber}</h4>
```

At the end of `renderScoringBody`, after `await renderSubstitutionsSection(match, setNumber);`, add:

```js
  await renderIncidentsSection(match);
```

- [ ] **Step 5: Run the test**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/game-report-flows.spec.mjs -g "extraordinary event"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/game-report.js tests/e2e/game-report-flows.spec.mjs
git commit -m "feat: add extraordinary events and decided-match banner to Game Report"
```

---

### Task 12: Full test suite run

**Files:** none (verification task)

- [ ] **Step 1: Wire the new test files into `package.json`**

`test:rls` in `package.json` currently lists Teilprojekt-1 files by exact path (no glob), so the three new test files from Tasks 1–5 of this plan (`schema-sumula.test.mjs`, `game-report-rls.test.mjs`, `game-report-rpc.test.mjs`) are not yet included. Update the script:

```json
"test:rls": "node --test tests/rls.test.mjs tests/migrate-sheet-data.test.mjs tests/schema.test.mjs tests/schema-sumula.test.mjs tests/game-report-rls.test.mjs tests/game-report-rpc.test.mjs"
```

- [ ] **Step 2: Reset the local DB for a clean run**

Run: `npx supabase db reset && set -a && source .env && set +a && node scripts/seed-roles.mjs && node scripts/generate-admin-config.mjs`

- [ ] **Step 3: Run everything**

Run: `set -a && source .env && set +a && npm run test`

Expected: all suites pass — `test:unit` 6 (unchanged), `test:rls` 31 (`rls.test.mjs` 6 + `migrate-sheet-data.test.mjs` 2 + `schema.test.mjs` 3 + `schema-sumula.test.mjs` 4 + `game-report-rls.test.mjs` 5 + `game-report-rpc.test.mjs` 11), `test:e2e` 13 (`admin-flows.spec.mjs` 7 + `game-report-flows.spec.mjs` 6) — 50 tests total.

- [ ] **Step 4: If anything fails, fix the root cause**

Investigate in the actual application/schema/RPC code, not the test. Re-run Step 3 until everything passes.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: wire new Sumula test files into test:rls"
```

(If Step 4 required additional fixes beyond `package.json`, include them in this commit or a separate one with an accurate message.)

---

### Task 13: Deploy to the real Supabase project

**Files:** none (operational task)

- [ ] **Step 1: Push the new migrations**

Run: `set -a && source .env.prod && set +a && npx supabase db push --password "$SUPABASE_DB_PASSWORD"`

(Recreate `.env.prod` from the real project's credentials if it's not present in this environment — see Teilprojekt 1 Task 14 for the exact values: URL, anon key, service role key, DB password, access token.)

Expected: the 5 new migrations from Tasks 1, 2, 3, 4, 5 apply cleanly (`Finished supabase db push`).

- [ ] **Step 2: Regenerate and verify the production admin config**

Run: `set -a && source .env.prod && set +a && node scripts/generate-admin-config.mjs`

Confirm `admin/config.js` points at the real project URL (not `127.0.0.1`).

- [ ] **Step 3: Spot-check the new tables exist**

Run:
```bash
set -a && source .env.prod && set +a && node -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  for (const t of ['players', 'player_events', 'substitutions', 'match_incidents']) {
    const { error, count } = await db.from(t).select('*', { count: 'exact', head: true });
    console.log(t, error ? 'ERROR: ' + error.message : 'ok, rows=' + count);
  }
});
"
```

Expected: all four print `ok, rows=0`.

- [ ] **Step 4: Manual acceptance check against the real project**

Serve `admin/` locally (`npx http-server admin -p 8080 -a 0.0.0.0 -c-1`), log in as admin, add a test team + player via the UI, log in as scorer, open Game Report, start a scheduled match (create one via Matches/Teams first if none exists), record a few points, use undo, record a card and a substitution, confirm everything appears correctly. Delete the test data afterward via the admin UI (or a service-role cleanup script) so it doesn't pollute the real tournament data.

- [ ] **Step 5: Commit the production `admin/config.js` if it changed**

```bash
git add admin/config.js
git commit -m "chore: regenerate production admin config after Sumula deploy"
```

(Only commit if `git diff admin/config.js` shows a real change — the URL/key shouldn't actually differ from what's already committed unless the Supabase project changed.)

## Self-Review Notes

- **Spec coverage:** Datenmodell (Task 1), Regel-Engine incl. `tag_last_point` gap-fix (Tasks 3–5), Zugriffskontrolle incl. tightening (Task 2), UI-Scope items 1–8 (Tasks 6–11: Kader=6, Match-Auswahl/Header/Start=7, Live-Scoring/Detail-Tags=8, Karten=9, Auswechslung=10, Sonstiges+Banner=11), Fehlerbehandlung (all UI tasks use inline error display, no optimistic updates — `selectMatch` always re-fetches from server), Testing (RPC/RLS tests in Tasks 1–5, Playwright smoke coverage across Tasks 6–11). All spec sections have a corresponding task.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command with expected output.
- **Type/name consistency checked:** RPC names (`record_point`, `tag_last_point`, `undo_last_point`, `record_timeout`) match exactly between the SQL migrations (Tasks 3–5) and the `admin/db.js` wrapper functions (Task 8). `admin/db.js` function names introduced in one task (e.g. `listPlayers` in Task 6) are reused with identical names and signatures in later tasks (Tasks 9–10). `game-report.js`'s module-level `currentMatchId`/`selectMatch`/`renderScoringBody` are introduced in Tasks 7–8 and consistently extended (not renamed) by Tasks 9–11.
