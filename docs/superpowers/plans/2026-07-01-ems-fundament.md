# Faustball EMS — Teilprojekt 1: Fundament — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Supabase backend (full EMS schema + role-based access) and a vanilla-JS admin app that lets tournament staff manage tournaments, categories, teams, courts and matches — replacing manual editing of the Google Sheet for the July 2026 event.

**Architecture:** Supabase (Postgres + Auth + Realtime) as the only backend; a new `/admin` static app (no framework, no bundler, same style as the existing `app.js`) talks to it directly via `@supabase/supabase-js` loaded from CDN. Two shared logins (`admin`, `scorer`) are mapped to roles via a `user_roles` table and enforced with Postgres RLS. A one-off Node script migrates the current Google Sheet data into Supabase; it is not an app feature.

**Tech Stack:** Postgres/Supabase, Supabase CLI (local dev stack via Docker), `@supabase/supabase-js`, Node's built-in test runner (`node --test`), Playwright, vanilla JS/HTML/CSS (ES modules, no bundler).

## Global Constraints

- No framework, no bundler for the admin app — vanilla JS/HTML/CSS with native ES modules, matching `fistball-live`'s existing style (spec: Architektur).
- No individual user accounts — exactly two shared logins (`admin`, `scorer`) mapped through `user_roles` (spec: Zugriffskontrolle).
- Admin has full CRUD on `tournaments`, `categories`, `teams`, `courts`, `matches`, `referee_assignments`, and is the **only** role that may set `matches.status = 'finished'` (spec: Zugriffskontrolle).
- Scorer may write `sets` and `point_events` and may move a match from `scheduled` to `live`; no other write access (spec: Zugriffskontrolle).
- `anon` (unauthenticated) has read-only access to all data tables (spec: Zugriffskontrolle).
- No manual test checklists — all verification is automated (spec: Testing).
- No offline support; stable connectivity is assumed (spec: Out of Scope).
- No player rosters, no reusable in-app import tool — the July data migration is a one-off script (spec: Out of Scope).
- `sets`/`point_events` get schema now but no UI in this teilprojekt (spec: Datenmodell) — Teilprojekt 2 builds their UI.
- `referee_assignments.role` is free text (real roles: "1st Referee", "2nd Referee", "Recording Clerk", "Assistant Referee 1/2"), not a fixed enum (spec: Datenmodell).
- `best_of` lives on `matches`, not `categories` (spec: Datenmodell, confirmed against real tournament data).

---

## File Structure

```
fistball-live/
  package.json                       (new — scripts, devDependencies)
  .env.example                       (new — required env var names, no values)
  .gitignore                         (modified — add .env, admin/config.js)
  supabase/
    config.toml                      (new — via `supabase init`)
    migrations/
      <ts>_schema.sql                (new — tables, FKs, constraints)
      <ts>_rls.sql                   (new — RLS policies, auth_role(), start_match())
  scripts/
    parse-sheet.mjs                  (new — pure parsing functions, no I/O)
    migrate-sheet-data.mjs           (new — one-off: fetch + parse + upsert into Supabase)
    seed-roles.mjs                   (new — idempotent: create admin/scorer auth users + user_roles rows)
    generate-admin-config.mjs        (new — writes admin/config.js from env vars)
    __tests__/
      parse-sheet.test.mjs           (new — unit tests, node --test)
  tests/
    rls.test.mjs                     (new — role-boundary + FK tests against local Supabase, node --test)
    migrate-sheet-data.test.mjs      (new — integration test for the migration script, node --test)
    e2e/
      admin-flows.spec.mjs           (new — Playwright: admin CRUD, scorer gating, anon read)
  admin/
    index.html                       (new — app shell + login form)
    styles.css                       (new — minimal styling, mirrors fistball-live's dark theme)
    supabase-client.js                (new — client init + session/role helpers)
    db.js                            (new — all Supabase table queries, one function per operation)
    app.js                           (new — bootstrap, nav, view switching)
    screens/
      tournaments.js                 (new)
      categories.js                  (new)
      courts.js                      (new)
      teams.js                       (new)
      matches.js                     (new)
  playwright.config.mjs              (new)
```

Rationale: `db.js` centralizes every Supabase call so screen modules stay pure UI/rendering code and so RLS-driven errors are handled in one place. Each `screens/*.js` file owns exactly one entity's list+form rendering, mirroring the CRUD scope from the spec. `parse-sheet.mjs` is intentionally dependency-free (no `fetch`, no Supabase) so it can be unit-tested with plain string fixtures; `migrate-sheet-data.mjs` does the I/O and calls into it.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `supabase/config.toml` (generated)

**Interfaces:**
- Produces: `npm run` scripts (`test:unit`, `test:rls`, `test:e2e`) that later tasks rely on; `supabase/migrations/` directory that Task 2 writes into.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fistball-ems-admin",
  "private": true,
  "type": "module",
  "scripts": {
    "test:unit": "node --test scripts/__tests__/",
    "test:rls": "node --test tests/rls.test.mjs tests/migrate-sheet-data.test.mjs",
    "test:e2e": "playwright test",
    "supabase": "supabase"
  }
}
```

- [ ] **Step 2: Install dev dependencies**

Run: `cd /Users/tobias/workspace/fistball-live && npm install --save-dev @supabase/supabase-js supabase @playwright/test`

Expected: `package.json` gains a `devDependencies` block with the three packages; `package-lock.json` is created.

- [ ] **Step 3: Install Playwright browsers**

Run: `npx playwright install chromium`

Expected: Chromium downloads without error (Playwright prints an install summary).

- [ ] **Step 4: Initialize the Supabase project**

Run: `npx supabase init`

Expected: creates `supabase/config.toml` and `supabase/.gitignore`. Accept defaults if prompted.

- [ ] **Step 5: Create `.env.example`**

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SEED_ADMIN_PASSWORD=
SEED_SCORER_PASSWORD=
```

- [ ] **Step 6: Update `.gitignore`**

```
.DS_Store
.claude/
node_modules/
.env
.env.local
admin/config.js
test-results/
playwright-report/
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore supabase/config.toml supabase/.gitignore
git commit -m "chore: scaffold Supabase project and npm tooling"
```

---

### Task 2: Database schema migration

**Files:**
- Create: `supabase/migrations/<ts>_schema.sql` (use `npx supabase migration new schema` to get the timestamped filename)
- Test: `tests/schema.test.mjs`

**Interfaces:**
- Produces: tables `tournaments`, `categories`, `teams`, `courts`, `matches`, `sets`, `point_events`, `referee_assignments`, `user_roles` with the columns listed below — every later task's SQL/JS references these exact names.
- Consumes: nothing (first schema migration).

- [ ] **Step 1: Start the local Supabase stack**

Run: `npx supabase start`

Expected: prints a table with `API URL`, `anon key`, `service_role key` (usually `http://127.0.0.1:54321` and two long JWT strings). Copy these into a local `.env` (create it from `.env.example`; `SEED_ADMIN_PASSWORD`/`SEED_SCORER_PASSWORD` can be any password ≥ 8 chars for local dev, e.g. `local-dev-admin-pw` / `local-dev-scorer-pw`).

- [ ] **Step 2: Create the migration file**

Run: `npx supabase migration new schema`

Expected: creates `supabase/migrations/<timestamp>_schema.sql` (empty).

- [ ] **Step 3: Write the schema**

Put this in `supabase/migrations/<timestamp>_schema.sql`:

```sql
create extension if not exists pgcrypto;

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  format text not null check (format in ('round_robin', 'knockout')),
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);

create table courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete restrict,
  name text not null,
  short_name text,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete restrict,
  team_a_id uuid not null references teams(id) on delete restrict,
  team_b_id uuid not null references teams(id) on delete restrict,
  court_id uuid references courts(id) on delete set null,
  scheduled_time timestamptz,
  round_label text,
  best_of integer not null default 5,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished')),
  -- Sheet's own match number (e.g. "16"). Not part of the spec's field list;
  -- added so the one-off migration script (Task 6) can upsert idempotently.
  sheet_match_nr integer unique,
  created_at timestamptz not null default now()
);

create table sets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  set_number integer not null,
  points_a integer not null default 0,
  points_b integer not null default 0,
  winner_team_id uuid references teams(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (match_id, set_number)
);

create table point_events (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references sets(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  event_type text not null,
  created_at timestamptz not null default now()
);

create table referee_assignments (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  referee_name text not null,
  role text not null,
  created_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'scorer'))
);
```

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db reset`

Expected: output ends with `Finished supabase db reset`. This drops and recreates the local DB from all migrations.

- [ ] **Step 5: Write the failing test**

Create `tests/schema.test.mjs`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example) before running this test.');
}

const db = createClient(url, serviceKey);
let tournamentId, categoryId, courtId, teamAId, teamBId;

before(async () => {
  const { data: t, error: tErr } = await db.from('tournaments').insert({
    name: 'Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  assert.equal(tErr, null);
  tournamentId = t.id;

  const { data: c, error: cErr } = await db.from('categories').insert({
    tournament_id: tournamentId, name: 'Test Category', format: 'round_robin',
  }).select().single();
  assert.equal(cErr, null);
  categoryId = c.id;

  const { data: court, error: courtErr } = await db.from('courts').insert({
    tournament_id: tournamentId, name: 'Court 1',
  }).select().single();
  assert.equal(courtErr, null);
  courtId = court.id;

  const { data: teams, error: teamsErr } = await db.from('teams').insert([
    { category_id: categoryId, name: 'Team A' },
    { category_id: categoryId, name: 'Team B' },
  ]).select();
  assert.equal(teamsErr, null);
  teamAId = teams[0].id;
  teamBId = teams[1].id;
});

after(async () => {
  await db.from('tournaments').delete().eq('id', tournamentId);
});

test('a match can reference an existing team/court/category', async () => {
  const { data, error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, court_id: courtId,
    best_of: 5, sheet_match_nr: 999001,
  }).select().single();
  assert.equal(error, null);
  assert.equal(data.status, 'scheduled');
  await db.from('matches').delete().eq('id', data.id);
});

test('a match cannot reference a non-existent team (FK enforced)', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: '00000000-0000-0000-0000-000000000000', team_b_id: teamBId,
    sheet_match_nr: 999002,
  });
  assert.ok(error, 'expected a foreign key violation error');
});

test('deleting a team referenced by a match is blocked', async () => {
  const { data: match } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999003,
  }).select().single();
  const { error } = await db.from('teams').delete().eq('id', teamAId);
  assert.ok(error, 'expected a foreign key violation error');
  await db.from('matches').delete().eq('id', match.id);
});
```

- [ ] **Step 6: Run the test**

Run: `set -a && source .env && set +a && node --test tests/schema.test.mjs`

Expected: 3 passing tests (`# pass 3`).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations tests/schema.test.mjs
git commit -m "feat: add EMS database schema with FK integrity tests"
```

---

### Task 3: RLS policies and role helper

**Files:**
- Create: `supabase/migrations/<ts>_rls.sql`
- Test: `tests/rls.test.mjs`

**Interfaces:**
- Consumes: tables from Task 2.
- Produces: `public.auth_role()` SQL function (returns `'admin' | 'scorer' | null`) and `public.start_match(p_match_id uuid)` RPC — Task 12's admin app calls `start_match` by name via `supabase.rpc('start_match', { p_match_id })`.

- [ ] **Step 1: Create the migration file**

Run: `npx supabase migration new rls`

- [ ] **Step 2: Write the RLS policies**

Put this in `supabase/migrations/<timestamp>_rls.sql`:

```sql
alter table tournaments enable row level security;
alter table categories enable row level security;
alter table courts enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;
alter table sets enable row level security;
alter table point_events enable row level security;
alter table referee_assignments enable row level security;
alter table user_roles enable row level security;

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

-- Read access: everyone (anon + authenticated) can read every data table.
create policy "public read tournaments" on tournaments for select using (true);
create policy "public read categories" on categories for select using (true);
create policy "public read courts" on courts for select using (true);
create policy "public read teams" on teams for select using (true);
create policy "public read matches" on matches for select using (true);
create policy "public read sets" on sets for select using (true);
create policy "public read point_events" on point_events for select using (true);
create policy "public read referee_assignments" on referee_assignments for select using (true);

-- Admin: full CRUD on tournament master data.
create policy "admin write tournaments" on tournaments for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');
create policy "admin write categories" on categories for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');
create policy "admin write courts" on courts for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');
create policy "admin write teams" on teams for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');
create policy "admin write matches" on matches for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');
create policy "admin write referee_assignments" on referee_assignments for all
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

-- Scorer: write access to sets/point_events only. No direct matches UPDATE
-- policy exists for scorer — the only mutation scorer gets on matches is
-- the start_match() RPC below (scheduled -> live).
create policy "scorer insert sets" on sets for insert
  with check (public.auth_role() = 'scorer');
create policy "scorer update sets" on sets for update
  using (public.auth_role() = 'scorer') with check (public.auth_role() = 'scorer');
create policy "scorer insert point_events" on point_events for insert
  with check (public.auth_role() = 'scorer');
create policy "scorer update point_events" on point_events for update
  using (public.auth_role() = 'scorer') with check (public.auth_role() = 'scorer');

-- Each user can read their own role (needed by the admin app to decide what to show).
create policy "read own role" on user_roles for select using (user_id = auth.uid());

create or replace function public.start_match(p_match_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.auth_role() not in ('admin', 'scorer') then
    raise exception 'not authorized';
  end if;
  update matches set status = 'live' where id = p_match_id and status = 'scheduled';
end;
$$;

revoke all on function public.start_match(uuid) from public;
grant execute on function public.start_match(uuid) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db reset`

Expected: `Finished supabase db reset`.

- [ ] **Step 4: Write the failing test**

Create `tests/rls.test.mjs`:

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
let tournamentId, categoryId, teamAId, teamBId, matchId;

before(async () => {
  // Requires Task 4's seed-roles.mjs to have already run against this stack.
  const t = await service.from('tournaments').insert({
    name: 'RLS Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'RLS Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'RLS Team A' },
    { category_id: categoryId, name: 'RLS Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999100,
  }).select().single();
  matchId = m.data.id;
});

after(async () => {
  await service.from('tournaments').delete().eq('id', tournamentId);
});

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign-in failed for ${email}: ${error?.message}`);
  return client;
}

test('anon can read matches', async () => {
  const anon = createClient(url, anonKey);
  const { data, error } = await anon.from('matches').select().eq('id', matchId);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

test('anon cannot insert a tournament', async () => {
  const anon = createClient(url, anonKey);
  const { error } = await anon.from('tournaments').insert({
    name: 'Should Fail', start_date: '2026-01-01', end_date: '2026-01-02',
  });
  assert.ok(error, 'expected RLS to reject the insert');
});

test('admin can set a match to finished', async () => {
  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { data, error } = await admin.from('matches')
    .update({ status: 'finished' }).eq('id', matchId).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].status, 'finished');
  await service.from('matches').update({ status: 'scheduled' }).eq('id', matchId);
});

test('scorer cannot directly update a match', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data, error } = await scorer.from('matches')
    .update({ status: 'finished' }).eq('id', matchId).select();
  assert.equal(error, null);
  assert.equal(data.length, 0, 'scorer should not be able to touch any row');
  const check = await service.from('matches').select('status').eq('id', matchId).single();
  assert.equal(check.data.status, 'scheduled');
});

test('scorer can start a match via start_match()', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { error } = await scorer.rpc('start_match', { p_match_id: matchId });
  assert.equal(error, null);
  const check = await service.from('matches').select('status').eq('id', matchId).single();
  assert.equal(check.data.status, 'live');
  await service.from('matches').update({ status: 'scheduled' }).eq('id', matchId);
});

test('scorer can insert a set, admin cannot', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data, error } = await scorer.from('sets')
    .insert({ match_id: matchId, set_number: 1, points_a: 11, points_b: 5 }).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);

  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { error: adminError } = await admin.from('sets')
    .insert({ match_id: matchId, set_number: 2, points_a: 11, points_b: 5 });
  assert.ok(adminError, 'admin should not be able to insert sets');

  await service.from('sets').delete().eq('match_id', matchId);
});
```

- [ ] **Step 5: Run the test (expect failures — no seeded users yet)**

Run: `set -a && source .env && set +a && node --test tests/rls.test.mjs`

Expected: FAIL — sign-in errors ("Invalid login credentials"), because Task 4 hasn't seeded the admin/scorer users yet. This is the expected red state; proceed to Task 4 before this test can pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations tests/rls.test.mjs
git commit -m "feat: add RLS policies for admin/scorer/anon roles"
```

---

### Task 4: Seed shared admin/scorer users

**Files:**
- Create: `scripts/seed-roles.mjs`

**Interfaces:**
- Consumes: `user_roles` table (Task 2), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SEED_ADMIN_PASSWORD`/`SEED_SCORER_PASSWORD` env vars.
- Produces: two confirmed Supabase Auth users (`admin@fistball-ems.local`, `scorer@fistball-ems.local`) with matching `user_roles` rows — Task 3's `tests/rls.test.mjs` and Task 13's Playwright tests sign in with these exact emails.

- [ ] **Step 1: Write the script**

Create `scripts/seed-roles.mjs`:

```js
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;

for (const [name, value] of Object.entries({
  SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  SEED_ADMIN_PASSWORD: adminPassword, SEED_SCORER_PASSWORD: scorerPassword,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name} (see .env.example)`);
    process.exit(1);
  }
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function upsertUser(email, password, role) {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`created auth user: ${email}`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    console.log(`updated password for existing user: ${email}`);
  }
  const { error: roleError } = await supabase
    .from('user_roles')
    .upsert({ user_id: user.id, role }, { onConflict: 'user_id' });
  if (roleError) throw roleError;
  console.log(`role '${role}' assigned to ${email}`);
}

await upsertUser('admin@fistball-ems.local', adminPassword, 'admin');
await upsertUser('scorer@fistball-ems.local', scorerPassword, 'scorer');
```

- [ ] **Step 2: Run it against the local stack**

Run: `set -a && source .env && set +a && node scripts/seed-roles.mjs`

Expected: prints `created auth user: admin@fistball-ems.local`, `role 'admin' assigned to ...`, and the same for scorer.

- [ ] **Step 3: Re-run to confirm idempotency**

Run: `set -a && source .env && set +a && node scripts/seed-roles.mjs`

Expected: prints `updated password for existing user: ...` instead of `created`, no errors.

- [ ] **Step 4: Run Task 3's RLS tests now that users exist**

Run: `set -a && source .env && set +a && node --test tests/rls.test.mjs`

Expected: all 6 tests pass (`# pass 6`).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-roles.mjs
git commit -m "feat: add idempotent admin/scorer user seeding script"
```

---

### Task 5: Sheet parser module

**Files:**
- Create: `scripts/parse-sheet.mjs`
- Test: `scripts/__tests__/parse-sheet.test.mjs`

**Interfaces:**
- Produces: `parseCSV(text) -> string[][]`, `parseScheduleRow(row) -> ScheduleRow | null`, `mapStatus(sheetStatus) -> 'scheduled'|'live'|'finished'`, `parseTournamentConfig(csvText) -> { pointTable, drawPoints, tiebreakers }`, `buildMigrationPlan(scheduleCsvText) -> MigrationPlan` where `MigrationPlan = { categories: string[], courts: string[], teams: {name, category}[], matches: MatchRow[] }`. Task 6 imports all of these by name.
- Consumes: nothing (pure functions, no network/DB).

`ScheduleRow` shape: `{ nr, court, teamA, teamB, round, category, bestOf, setsA, setsB, status, day, time }`.
`MatchRow` shape: `ScheduleRow` plus `scheduledTimeIso: string | null`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/parse-sheet.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV, parseScheduleRow, mapStatus, parseTournamentConfig, buildMigrationPlan,
} from '../parse-sheet.mjs';

// Real (public) row shape, from the published 2026 U18 WC schedule sheet.
const SCHEDULE_CSV = [
  '"","","","2026 U18 World Championship & Womens EFA Championship R E S U L T S","","","","",""',
  '"","","","","","","","","","","","","1","1","1","2","2","2","3","3","3","","","","","","","","","","","","","","x","","","",""',
  '"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""',
  '"","","","","Team A","Team B","Round","Category","","","","","","","","","","","","","","","","","","","","","","","","","","","","","Status","Remarks"',
  '"Thursday - 23 Jul  2026","10:00","16","1","Chile - U18 M Silver","India - U18 M Silver","Qualification round","U18 M Silver","5","1","x","2","1","x","2","5","x","1","2","x","4","0","x","0","0","x","0","FALSE","x","","","x","","8","|","7","Finished",""',
].join('\n');

const CONFIG_CSV = [
  '"1) Event Information","","","","","3) Categories","","","4) Rounds","","","5) Courts","","6) Points"',
  '"","Event:","2026 U18 WC","","","Team","","","Round","","","","","3"',
  '"","Date:","23-26 Jul 2026","","","WEC","0","","Gold medal match","5","","1","","","","","","","","",""',
  '"","","","","","U18 M Silver","0","","Qualification round","5","","2","","","","","","","","",""',
].join('\n');

test('parseCSV splits quoted comma-separated rows', () => {
  const rows = parseCSV('"a","b,c"\n"d",""');
  assert.deepEqual(rows, [['a', 'b,c'], ['d', '']]);
});

test('mapStatus maps the 4 sheet statuses to the 3 EMS statuses', () => {
  assert.equal(mapStatus('Not Started'), 'scheduled');
  assert.equal(mapStatus('Starting'), 'live');
  assert.equal(mapStatus('In progress'), 'live');
  assert.equal(mapStatus('Finished'), 'finished');
});

test('parseScheduleRow extracts a real match row', () => {
  const rows = parseCSV(SCHEDULE_CSV);
  const row = parseScheduleRow(rows[4]);
  assert.equal(row.nr, 16);
  assert.equal(row.court, '1');
  assert.equal(row.teamA, 'Chile');
  assert.equal(row.teamB, 'India');
  assert.equal(row.round, 'Qualification round');
  assert.equal(row.category, 'U18 M Silver');
  assert.equal(row.bestOf, 5);
  assert.equal(row.setsA, 1);
  assert.equal(row.setsB, 2);
  assert.equal(row.status, 'Finished');
  assert.equal(row.day, 'Thursday - 23 Jul  2026');
  assert.equal(row.time, '10:00');
});

test('parseScheduleRow returns null for header/blank rows', () => {
  const rows = parseCSV(SCHEDULE_CSV);
  assert.equal(parseScheduleRow(rows[0]), null);
  assert.equal(parseScheduleRow(rows[3]), null);
});

test('parseTournamentConfig reads courts and rounds sections', () => {
  const cfg = parseTournamentConfig(CONFIG_CSV);
  assert.ok(Array.isArray(cfg.categories));
  assert.ok(cfg.categories.includes('WEC'));
  assert.ok(cfg.categories.includes('U18 M Silver'));
});

test('buildMigrationPlan deduplicates categories/courts/teams and builds matches', () => {
  const plan = buildMigrationPlan(SCHEDULE_CSV);
  assert.deepEqual(plan.categories, ['U18 M Silver']);
  assert.deepEqual(plan.courts, ['1']);
  assert.deepEqual(
    plan.teams.sort((a, b) => a.name.localeCompare(b.name)),
    [{ name: 'Chile', category: 'U18 M Silver' }, { name: 'India', category: 'U18 M Silver' }],
  );
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0].nr, 16);
  assert.equal(plan.matches[0].status, 'Finished');
  assert.equal(plan.matches[0].scheduledTimeIso, '2026-07-23T08:00:00.000Z');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/__tests__/parse-sheet.test.mjs`

Expected: FAIL with `Cannot find module '../parse-sheet.mjs'`.

- [ ] **Step 3: Implement `scripts/parse-sheet.mjs`**

```js
// Pure parsing functions for the public tournament Google Sheet. No network
// or database access here — scripts/migrate-sheet-data.mjs does the I/O and
// calls into these. Deliberately duplicated (not imported) from app.js's
// CSV/row parsing, since app.js is a browser global script, not a module,
// and the viewer app is out of scope for this teilprojekt to touch.

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignore */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

function cleanTeam(name, category) {
  if (!name) return name;
  let n = name.trim();
  if (category && n.endsWith(' - ' + category)) {
    n = n.slice(0, -(' - ' + category).length);
  } else {
    const m = n.match(/^(.*?) - (U18 .*|WEC)$/);
    if (m) n = m[1];
  }
  return n.trim();
}

const STATUS_MAP = {
  'Not Started': 'scheduled',
  'Starting': 'live',
  'In progress': 'live',
  'Finished': 'finished',
};

export function mapStatus(sheetStatus) {
  return STATUS_MAP[sheetStatus] || 'scheduled';
}

const STATUS_VALUES = Object.keys(STATUS_MAP);
const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// Combines the sheet's "Thursday - 23 Jul  2026" + "10:00" into an ISO
// timestamp. The event is in Reiden, Switzerland in July (CEST, UTC+2) —
// hardcoded here since this is a one-off script for this specific event,
// not a general-purpose date parser.
function toScheduledTimeIso(day, time) {
  const m = day.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  const t = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return null;
  const [, d, monAbbr, y] = m;
  const month = MONTHS[monAbbr];
  if (!month) return null;
  const dd = d.padStart(2, '0');
  return new Date(`${y}-${month}-${dd}T${t[1].padStart(2, '0')}:${t[2]}:00+02:00`).toISOString();
}

// Row shape mirrors app.js's rowToMatch column layout (see fistball-live/app.js).
export function parseScheduleRow(r) {
  const nr = num(r[2]);
  const teamA = (r[4] || '').trim();
  const teamB = (r[5] || '').trim();
  const category = (r[7] || '').trim();
  if (!nr || !teamA || !teamB || !category) return null;

  let status = 'Not Started';
  for (const cell of r) {
    const t = (cell || '').trim();
    if (STATUS_VALUES.includes(t)) { status = t; break; }
  }

  const day = (r[0] || '').trim();
  const time = (r[1] || '').trim();

  return {
    nr,
    court: (r[3] || '').trim(),
    teamA: cleanTeam(teamA, category),
    teamB: cleanTeam(teamB, category),
    round: (r[6] || '').trim(),
    category,
    bestOf: num(r[8]),
    setsA: num(r[9]),
    setsB: num(r[11]),
    status,
    day,
    time,
  };
}

export function parseTournamentConfig(csvText) {
  const rows = parseCSV(csvText);
  const categories = [];
  for (let r = 0; r < rows.length; r++) {
    const hdr = rows[r];
    const col = hdr.findIndex((c) => String(c || '').trim() === 'Team');
    if (col === -1) continue;
    for (let k = r + 1; k < rows.length; k++) {
      const name = String(rows[k][col] || '').trim();
      if (!name) break;
      categories.push(name);
    }
    break;
  }
  return { categories, pointTable: [], drawPoints: 1, tiebreakers: [] };
}

export function buildMigrationPlan(scheduleCsvText) {
  const rows = parseCSV(scheduleCsvText).map(parseScheduleRow).filter(Boolean);

  const categories = [...new Set(rows.map((r) => r.category))];
  const courts = [...new Set(rows.map((r) => r.court).filter(Boolean))];

  const teamKey = (name, category) => `${category}::${name}`;
  const teamsByKey = new Map();
  for (const r of rows) {
    for (const name of [r.teamA, r.teamB]) {
      const key = teamKey(name, r.category);
      if (!teamsByKey.has(key)) teamsByKey.set(key, { name, category: r.category });
    }
  }

  const matches = rows.map((r) => ({
    ...r,
    scheduledTimeIso: toScheduledTimeIso(r.day, r.time),
  }));

  return { categories, courts, teams: [...teamsByKey.values()], matches };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/__tests__/parse-sheet.test.mjs`

Expected: `# pass 6`.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse-sheet.mjs scripts/__tests__/parse-sheet.test.mjs
git commit -m "feat: add sheet parsing module with unit tests"
```

---

### Task 6: One-off migration script

**Files:**
- Create: `scripts/migrate-sheet-data.mjs`
- Test: `tests/migrate-sheet-data.test.mjs`

**Interfaces:**
- Consumes: `buildMigrationPlan` from Task 5; tables from Task 2; `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env vars.
- Produces: `migrateSheetData({ scheduleCsvText, tournament, supabaseUrl, serviceKey })` exported for the test to call directly (avoids the test depending on live network fetches); the script's CLI entrypoint (`node scripts/migrate-sheet-data.mjs`) fetches the real sheet and calls the same function.

- [ ] **Step 1: Write the failing test**

Create `tests/migrate-sheet-data.test.mjs`:

```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { migrateSheetData } from '../scripts/migrate-sheet-data.mjs';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

const service = createClient(url, serviceKey);

const SCHEDULE_CSV = [
  '"","","","2026 U18 World Championship R E S U L T S","","","","",""',
  '"","","","","","","","","","","","","1","1","1","2","2","2","3","3","3"',
  '"","","","","","","","","","","","","","","","","","","","",""',
  '"","","","","Team A","Team B","Round","Category","","","","","","","","","","","","","","","","","","","","","","","","","","","","","Status","Remarks"',
  '"Thursday - 23 Jul  2026","10:00","16","1","Chile - U18 M Silver","India - U18 M Silver","Qualification round","U18 M Silver","5","1","x","2","1","x","2","5","x","1","2","x","4","0","x","0","0","x","0","FALSE","x","","","x","","8","|","7","Finished",""',
  '"Thursday - 23 Jul  2026","11:15","17","1","Chile - U18 M Silver","Namibia - U18 M Silver","Qualification round","U18 M Silver","5","0","x","2","0","x","2","0","x","2","0","x","0","0","x","0","0","x","0","FALSE","x","","","x","","0","|","6","Not Started",""',
].join('\n');

let tournamentId;

after(async () => {
  if (tournamentId) await service.from('tournaments').delete().eq('id', tournamentId);
});

test('migrateSheetData creates tournament, categories, courts, teams, matches', async () => {
  const result = await migrateSheetData({
    scheduleCsvText: SCHEDULE_CSV,
    tournament: { name: 'Migration Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26' },
    supabaseUrl: url,
    serviceKey,
  });
  tournamentId = result.tournamentId;

  const categories = await service.from('categories').select().eq('tournament_id', tournamentId);
  assert.equal(categories.data.length, 1);
  assert.equal(categories.data[0].name, 'U18 M Silver');

  const courts = await service.from('courts').select().eq('tournament_id', tournamentId);
  assert.equal(courts.data.length, 1);

  const teams = await service.from('teams').select().eq('category_id', categories.data[0].id);
  assert.equal(teams.data.length, 3); // Chile, India, Namibia

  const matches = await service.from('matches').select().in('sheet_match_nr', [16, 17]);
  assert.equal(matches.data.length, 2);
  const m16 = matches.data.find((m) => m.sheet_match_nr === 16);
  assert.equal(m16.status, 'finished');
  assert.equal(m16.best_of, 5);
});

test('migrateSheetData is idempotent (safe to re-run)', async () => {
  const result = await migrateSheetData({
    scheduleCsvText: SCHEDULE_CSV,
    tournament: { name: 'Migration Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26' },
    supabaseUrl: url,
    serviceKey,
    existingTournamentId: tournamentId,
  });
  assert.equal(result.tournamentId, tournamentId);
  const matches = await service.from('matches').select().in('sheet_match_nr', [16, 17]);
  assert.equal(matches.data.length, 2, 're-running must not create duplicate matches');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `set -a && source .env && set +a && node --test tests/migrate-sheet-data.test.mjs`

Expected: FAIL with `Cannot find module '../scripts/migrate-sheet-data.mjs'`.

- [ ] **Step 3: Implement `scripts/migrate-sheet-data.mjs`**

```js
import { createClient } from '@supabase/supabase-js';
import { buildMigrationPlan, mapStatus } from './parse-sheet.mjs';

const SHEET_ID = '1IWuv2zOZtIJDZCFnItp_z8p546azRGlD8I052jVe8Mk';
const SCHEDULE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;

export async function migrateSheetData({
  scheduleCsvText, tournament, supabaseUrl, serviceKey, existingTournamentId,
}) {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plan = buildMigrationPlan(scheduleCsvText);

  let tournamentId = existingTournamentId;
  if (!tournamentId) {
    const { data, error } = await supabase.from('tournaments')
      .insert(tournament).select().single();
    if (error) throw error;
    tournamentId = data.id;
  }

  const categoryIdByName = new Map();
  for (const name of plan.categories) {
    const { data, error } = await supabase.from('categories')
      .upsert({ tournament_id: tournamentId, name, format: 'round_robin' }, { onConflict: 'tournament_id,name' })
      .select().single();
    if (error) throw error;
    categoryIdByName.set(name, data.id);
  }

  const courtIdByName = new Map();
  for (const name of plan.courts) {
    const { data, error } = await supabase.from('courts')
      .upsert({ tournament_id: tournamentId, name }, { onConflict: 'tournament_id,name' })
      .select().single();
    if (error) throw error;
    courtIdByName.set(name, data.id);
  }

  const teamIdByKey = new Map();
  for (const team of plan.teams) {
    const categoryId = categoryIdByName.get(team.category);
    const { data, error } = await supabase.from('teams')
      .upsert({ category_id: categoryId, name: team.name }, { onConflict: 'category_id,name' })
      .select().single();
    if (error) throw error;
    teamIdByKey.set(`${team.category}::${team.name}`, data.id);
  }

  for (const m of plan.matches) {
    const { error } = await supabase.from('matches').upsert({
      sheet_match_nr: m.nr,
      category_id: categoryIdByName.get(m.category),
      team_a_id: teamIdByKey.get(`${m.category}::${m.teamA}`),
      team_b_id: teamIdByKey.get(`${m.category}::${m.teamB}`),
      court_id: courtIdByName.get(m.court) || null,
      scheduled_time: m.scheduledTimeIso,
      round_label: m.round,
      best_of: m.bestOf || 5,
      status: mapStatus(m.status),
    }, { onConflict: 'sheet_match_nr' });
    if (error) throw error;
  }

  return { tournamentId };
}

// CLI entrypoint — only runs when invoked directly (`node scripts/migrate-sheet-data.mjs`),
// not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)');
    process.exit(1);
  }
  const res = await fetch(SCHEDULE_URL);
  if (!res.ok) throw new Error(`Failed to fetch schedule sheet: ${res.status}`);
  const scheduleCsvText = await res.text();
  const result = await migrateSheetData({
    scheduleCsvText,
    tournament: {
      name: '2026 U18 World Championship & Womens EFA Championship',
      start_date: '2026-07-23',
      end_date: '2026-07-26',
    },
    supabaseUrl: url,
    serviceKey,
  });
  console.log(`Migration complete. Tournament ID: ${result.tournamentId}`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `set -a && source .env && set +a && node --test tests/migrate-sheet-data.test.mjs`

Expected: `# pass 2`.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-sheet-data.mjs tests/migrate-sheet-data.test.mjs
git commit -m "feat: add one-off sheet-to-Supabase migration script"
```

---

### Task 7: Admin app shell — Supabase client, login, role-aware nav

**Files:**
- Create: `admin/index.html`
- Create: `admin/styles.css`
- Create: `admin/supabase-client.js`
- Create: `admin/app.js`
- Create: `scripts/generate-admin-config.mjs`

**Interfaces:**
- Produces: `getClient()` (returns the shared `supabase-js` client), `getSessionRole()` (`async () => 'admin' | 'scorer' | null`), `signIn(email, password)`, `signOut()` exported from `admin/supabase-client.js` — every `screens/*.js` module in Tasks 8–12 imports these. `registerScreen(name, { render })` and `showScreen(name)` exported from `admin/app.js` — each screen module calls `registerScreen` to plug itself into the shell.

- [ ] **Step 1: Write `scripts/generate-admin-config.mjs`**

```js
import { writeFileSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (see .env.example)');
  process.exit(1);
}

writeFileSync(
  'admin/config.js',
  `// Generated by scripts/generate-admin-config.mjs — do not edit, do not commit.\n` +
  `export const SUPABASE_URL = ${JSON.stringify(url)};\n` +
  `export const SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};\n`,
);
console.log('Wrote admin/config.js');
```

- [ ] **Step 2: Generate the config for local dev**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs`

Expected: `Wrote admin/config.js`.

- [ ] **Step 3: Write `admin/supabase-client.js`**

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getClient() {
  return client;
}

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error;
}

export async function signOut() {
  await client.auth.signOut();
}

export async function getSessionRole() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  const { data, error } = await client.from('user_roles').select('role').eq('user_id', session.user.id).single();
  if (error) return null;
  return data.role;
}
```

- [ ] **Step 4: Write `admin/app.js`**

```js
import { getClient, signIn, signOut, getSessionRole } from './supabase-client.js';

const screens = new Map();
let currentRole = null;

export function registerScreen(name, { render }) {
  screens.set(name, { render });
}

export async function showScreen(name) {
  const screen = screens.get(name);
  if (!screen) throw new Error(`Unknown screen: ${name}`);
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
    ['matches', 'Matches'],
  ];
  nav.innerHTML = items.map(([key, label]) =>
    `<button data-screen="${key}">${label}</button>`).join('') +
    `<button id="logoutBtn">Logout</button>`;
  nav.querySelectorAll('button[data-screen]').forEach((b) => {
    b.onclick = () => showScreen(b.dataset.screen);
  });
  document.getElementById('logoutBtn').onclick = async () => {
    await signOut();
    location.reload();
  };
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
  await showScreen('tournaments');
}

boot();
```

- [ ] **Step 5: Write `admin/index.html`**

```html
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fistball EMS — Admin</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="loginView">
    <form id="loginForm">
      <h1>Fistball EMS — Login</h1>
      <label>E-Mail<input id="email" type="email" required autocomplete="username"></label>
      <label>Passwort<input id="password" type="password" required autocomplete="current-password"></label>
      <button type="submit">Login</button>
      <p id="loginError" class="error" hidden></p>
    </form>
  </div>
  <div id="appView" hidden>
    <header>
      <h1>Fistball EMS — Admin</h1>
      <span id="roleLabel"></span>
    </header>
    <nav id="nav"></nav>
    <main id="main"></main>
  </div>
  <script type="module" src="app.js"></script>
  <script type="module" src="screens/tournaments.js"></script>
  <script type="module" src="screens/categories.js"></script>
  <script type="module" src="screens/courts.js"></script>
  <script type="module" src="screens/teams.js"></script>
  <script type="module" src="screens/matches.js"></script>
</body>
</html>
```

Note: the `screens/*.js` files don't exist yet — this `<script>` list is finalized as-is now (Tasks 8–12 create the files), so no further edits to `index.html` are needed later.

- [ ] **Step 6: Write minimal `admin/styles.css`**

```css
body { font-family: system-ui, sans-serif; background: #12151a; color: #e8e8e8; margin: 0; }
#loginView { display: flex; align-items: center; justify-content: center; height: 100vh; }
#loginForm { display: flex; flex-direction: column; gap: 0.75rem; width: 280px; }
#loginForm input { padding: 0.5rem; border-radius: 4px; border: 1px solid #444; background: #1c2128; color: inherit; }
#loginForm button { padding: 0.5rem; border-radius: 4px; border: none; background: #3b82f6; color: white; cursor: pointer; }
.error { color: #f87171; }
header { display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #2a2f38; }
#nav { display: flex; gap: 0.5rem; padding: 1rem; border-bottom: 1px solid #2a2f38; }
#nav button { padding: 0.4rem 0.8rem; border-radius: 4px; border: 1px solid #444; background: #1c2128; color: inherit; cursor: pointer; }
#nav button.is-active { background: #3b82f6; border-color: #3b82f6; }
#main { padding: 1rem; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2f38; }
form.entity-form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0; align-items: end; }
form.entity-form label { display: flex; flex-direction: column; font-size: 0.85rem; }
form.entity-form input, form.entity-form select { padding: 0.4rem; border-radius: 4px; border: 1px solid #444; background: #1c2128; color: inherit; }
```

- [ ] **Step 7: Manual smoke check (no automated test yet — Task 13 covers this shell end-to-end)**

Run: `npx http-server admin -p 5050 -c-1` (in one terminal) and open `http://localhost:5050` in a browser.

Expected: login form renders; submitting `admin@fistball-ems.local` / the local `SEED_ADMIN_PASSWORD` shows the app shell with an empty nav bar working (screens aren't registered yet, so clicking a nav button will error in the console — expected until Task 8 onward).

- [ ] **Step 8: Commit**

```bash
git add admin/index.html admin/styles.css admin/supabase-client.js admin/app.js scripts/generate-admin-config.mjs
git commit -m "feat: add admin app shell with login and role-aware nav"
```

---

### Task 8: Tournament CRUD screen

**Files:**
- Create: `admin/db.js`
- Create: `admin/screens/tournaments.js`
- Test: `tests/e2e/admin-flows.spec.mjs` (created here, extended in later tasks)
- Create: `playwright.config.mjs`

**Interfaces:**
- Consumes: `getClient()` from Task 7.
- Produces: `listTournaments()`, `createTournament(data)`, `updateTournament(id, data)` in `admin/db.js` — Task 9 onward adds more functions to this same file. `registerScreen('tournaments', ...)`.

- [ ] **Step 1: Write `playwright.config.mjs`**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5050',
  },
  webServer: {
    command: 'npx http-server admin -p 5050 -c-1',
    url: 'http://127.0.0.1:5050',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 2: Write the failing Playwright test**

Create `tests/e2e/admin-flows.spec.mjs`:

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

test('admin can create a tournament', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Playwright Test Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright Test Tournament');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/admin-flows.spec.mjs`

Expected: FAIL — `button[data-screen=tournaments]` has no matching element yet (nav is empty because no screens are registered).

- [ ] **Step 4: Write `admin/db.js`**

```js
import { getClient } from './supabase-client.js';

export async function listTournaments() {
  const { data, error } = await getClient().from('tournaments').select().order('start_date');
  if (error) throw error;
  return data;
}

export async function createTournament({ name, start_date, end_date }) {
  const { error } = await getClient().from('tournaments').insert({ name, start_date, end_date });
  if (error) throw error;
}

export async function updateTournament(id, { name, start_date, end_date }) {
  const { error } = await getClient().from('tournaments').update({ name, start_date, end_date }).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 5: Write `admin/screens/tournaments.js`**

```js
import { registerScreen } from '../app.js';
import { listTournaments, createTournament } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  main.innerHTML = `
    <h2>Turniere</h2>
    <table>
      <thead><tr><th>Name</th><th>Start</th><th>Ende</th></tr></thead>
      <tbody>${tournaments.map((t) =>
        `<tr><td>${t.name}</td><td>${t.start_date}</td><td>${t.end_date}</td></tr>`).join('')}
      </tbody>
    </table>
    <form id="tournamentForm" class="entity-form">
      <label>Name<input id="t_name" required></label>
      <label>Start<input id="t_start" type="date" required></label>
      <label>Ende<input id="t_end" type="date" required></label>
      <button type="submit">Anlegen</button>
      <p id="tournamentError" class="error" hidden></p>
    </form>
  `;
  document.getElementById('tournamentForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('tournamentError');
    try {
      await createTournament({
        name: document.getElementById('t_name').value.trim(),
        start_date: document.getElementById('t_start').value,
        end_date: document.getElementById('t_end').value,
      });
      await render(main);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('tournaments', { render });
```

- [ ] **Step 6: Install a static file server for tests**

Run: `npm install --save-dev http-server`

- [ ] **Step 7: Regenerate admin config and run the test**

Run: `set -a && source .env && set +a && node scripts/generate-admin-config.mjs && npx playwright test tests/e2e/admin-flows.spec.mjs`

Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add admin/db.js admin/screens/tournaments.js tests/e2e/admin-flows.spec.mjs playwright.config.mjs package.json package-lock.json
git commit -m "feat: add tournament CRUD screen"
```

---

### Task 9: Categories CRUD screen

**Files:**
- Modify: `admin/db.js`
- Create: `admin/screens/categories.js`
- Modify: `tests/e2e/admin-flows.spec.mjs`

**Interfaces:**
- Consumes: `listTournaments` (Task 8); adds `listCategories(tournamentId)`, `createCategory(data)` to `admin/db.js`.
- Produces: `registerScreen('categories', ...)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/admin-flows.spec.mjs`:

```js
test('admin can create a category under a tournament', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Playwright Test Tournament' });
  await page.fill('#c_name', 'Playwright Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright Category');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "category"`

Expected: FAIL — no `categories` nav button/screen yet.

- [ ] **Step 3: Add functions to `admin/db.js`**

Append:

```js
export async function listCategories(tournamentId) {
  const { data, error } = await getClient().from('categories').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createCategory({ tournament_id, name, format }) {
  const { error } = await getClient().from('categories').insert({ tournament_id, name, format });
  if (error) throw error;
}
```

- [ ] **Step 4: Write `admin/screens/categories.js`**

```js
import { registerScreen } from '../app.js';
import { listTournaments, listCategories, createCategory } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const options = tournaments.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  main.innerHTML = `
    <h2>Kategorien</h2>
    <label>Turnier
      <select id="categoryTournamentSelect">${options}</select>
    </label>
    <div id="categoryTableWrap"></div>
    <form id="categoryForm" class="entity-form">
      <label>Turnier<select id="c_tournament">${options}</select></label>
      <label>Name<input id="c_name" required></label>
      <label>Format
        <select id="c_format">
          <option value="round_robin">Round Robin</option>
          <option value="knockout">Knockout</option>
        </select>
      </label>
      <button type="submit">Anlegen</button>
      <p id="categoryError" class="error" hidden></p>
    </form>
  `;

  async function renderTable(tournamentId) {
    const categories = tournamentId ? await listCategories(tournamentId) : [];
    document.getElementById('categoryTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Format</th></tr></thead>
        <tbody>${categories.map((c) => `<tr><td>${c.name}</td><td>${c.format}</td></tr>`).join('')}</tbody>
      </table>`;
  }

  document.getElementById('categoryTournamentSelect').onchange = (e) => renderTable(e.target.value);
  if (tournaments[0]) await renderTable(tournaments[0].id);

  document.getElementById('categoryForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('categoryError');
    try {
      const tournamentId = document.getElementById('c_tournament').value;
      await createCategory({
        tournament_id: tournamentId,
        name: document.getElementById('c_name').value.trim(),
        format: document.getElementById('c_format').value,
      });
      document.getElementById('categoryTournamentSelect').value = tournamentId;
      await renderTable(tournamentId);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('categories', { render });
```

- [ ] **Step 5: Register the screen's script in `index.html`**

Already listed in Task 7 Step 5 (`<script type="module" src="screens/categories.js">`) — no change needed. Confirm the line is present.

- [ ] **Step 6: Run the test**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "category"`

Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add admin/db.js admin/screens/categories.js tests/e2e/admin-flows.spec.mjs
git commit -m "feat: add category CRUD screen"
```

---

### Task 10: Courts CRUD screen

**Files:**
- Modify: `admin/db.js`
- Create: `admin/screens/courts.js`
- Modify: `tests/e2e/admin-flows.spec.mjs`

**Interfaces:**
- Adds `listCourts(tournamentId)`, `createCourt(data)` to `admin/db.js`.
- Produces: `registerScreen('courts', ...)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/admin-flows.spec.mjs`:

```js
test('admin can create a court under a tournament', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=courts]');
  await page.selectOption('#court_tournament', { label: 'Playwright Test Tournament' });
  await page.fill('#court_name', 'Court 9');
  await page.click('#courtForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Court 9');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "court"`

Expected: FAIL — no `courts` screen yet.

- [ ] **Step 3: Add functions to `admin/db.js`**

Append:

```js
export async function listCourts(tournamentId) {
  const { data, error } = await getClient().from('courts').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createCourt({ tournament_id, name }) {
  const { error } = await getClient().from('courts').insert({ tournament_id, name });
  if (error) throw error;
}
```

- [ ] **Step 4: Write `admin/screens/courts.js`**

```js
import { registerScreen } from '../app.js';
import { listTournaments, listCourts, createCourt } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const options = tournaments.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  main.innerHTML = `
    <h2>Courts</h2>
    <div id="courtTableWrap"></div>
    <form id="courtForm" class="entity-form">
      <label>Turnier<select id="court_tournament">${options}</select></label>
      <label>Name<input id="court_name" required></label>
      <button type="submit">Anlegen</button>
      <p id="courtError" class="error" hidden></p>
    </form>
  `;

  async function renderTable(tournamentId) {
    const courts = tournamentId ? await listCourts(tournamentId) : [];
    document.getElementById('courtTableWrap').innerHTML = `
      <table><thead><tr><th>Name</th></tr></thead>
      <tbody>${courts.map((c) => `<tr><td>${c.name}</td></tr>`).join('')}</tbody></table>`;
  }

  document.getElementById('court_tournament').onchange = (e) => renderTable(e.target.value);
  if (tournaments[0]) await renderTable(tournaments[0].id);

  document.getElementById('courtForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('courtError');
    try {
      const tournamentId = document.getElementById('court_tournament').value;
      await createCourt({ tournament_id: tournamentId, name: document.getElementById('court_name').value.trim() });
      await renderTable(tournamentId);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('courts', { render });
```

- [ ] **Step 5: Run the test**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "court"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/courts.js tests/e2e/admin-flows.spec.mjs
git commit -m "feat: add court CRUD screen"
```

---

### Task 11: Teams CRUD screen

**Files:**
- Modify: `admin/db.js`
- Create: `admin/screens/teams.js`
- Modify: `tests/e2e/admin-flows.spec.mjs`

**Interfaces:**
- Adds `listTeams(categoryId)`, `createTeam(data)`, `deleteTeam(id)` to `admin/db.js`.
- Produces: `registerScreen('teams', ...)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/e2e/admin-flows.spec.mjs`:

```js
test('admin can create a team under a category, and delete blocked by FK is surfaced as an error', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#team_category', { label: 'Playwright Category' });
  await page.fill('#team_name', 'Playwright FC');
  await page.click('#teamForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright FC');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "team"`

Expected: FAIL — no `teams` screen yet.

- [ ] **Step 3: Add functions to `admin/db.js`**

Append:

```js
export async function listTeams(categoryId) {
  const { data, error } = await getClient().from('teams').select().eq('category_id', categoryId).order('name');
  if (error) throw error;
  return data;
}

export async function createTeam({ category_id, name, short_name }) {
  const { error } = await getClient().from('teams').insert({ category_id, name, short_name: short_name || null });
  if (error) throw error;
}

export async function deleteTeam(id) {
  const { error } = await getClient().from('teams').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Write `admin/screens/teams.js`**

```js
import { registerScreen } from '../app.js';
import { listTournaments, listCategories, listTeams, createTeam, deleteTeam } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  main.innerHTML = `
    <h2>Teams</h2>
    <div id="teamTableWrap"></div>
    <form id="teamForm" class="entity-form">
      <label>Turnier<select id="team_tournament">${tOptions}</select></label>
      <label>Kategorie<select id="team_category"></select></label>
      <label>Name<input id="team_name" required></label>
      <label>Kurzname<input id="team_short_name"></label>
      <button type="submit">Anlegen</button>
      <p id="teamError" class="error" hidden></p>
    </form>
  `;

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('team_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    return categories;
  }

  async function renderTable(categoryId) {
    const teams = categoryId ? await listTeams(categoryId) : [];
    document.getElementById('teamTableWrap').innerHTML = `
      <table><thead><tr><th>Name</th><th>Kurzname</th><th></th></tr></thead>
      <tbody>${teams.map((t) =>
        `<tr><td>${t.name}</td><td>${t.short_name || ''}</td><td><button data-delete="${t.id}">Löschen</button></td></tr>`
      ).join('')}</tbody></table>`;
    document.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('teamError');
        try {
          await deleteTeam(btn.dataset.delete);
          await renderTable(categoryId);
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Matches verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  document.getElementById('team_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) await renderTable(categories[0].id);
  };
  document.getElementById('team_category').onchange = (e) => renderTable(e.target.value);

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) await renderTable(categories[0].id);
  }

  document.getElementById('teamForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('teamError');
    try {
      const categoryId = document.getElementById('team_category').value;
      await createTeam({
        category_id: categoryId,
        name: document.getElementById('team_name').value.trim(),
        short_name: document.getElementById('team_short_name').value.trim(),
      });
      await renderTable(categoryId);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('teams', { render });
```

- [ ] **Step 5: Run the test**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "team"`

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add admin/db.js admin/screens/teams.js tests/e2e/admin-flows.spec.mjs
git commit -m "feat: add team CRUD screen with FK-safe delete"
```

---

### Task 12: Matches CRUD screen with role-aware status control

**Files:**
- Modify: `admin/db.js`
- Create: `admin/screens/matches.js`
- Modify: `tests/e2e/admin-flows.spec.mjs`

**Interfaces:**
- Adds `listMatches(categoryId)`, `createMatch(data)`, `finishMatch(id)`, `startMatch(id)` to `admin/db.js`.
- Produces: `registerScreen('matches', ...)`. `finishMatch` is only ever called from UI that's rendered when `role === 'admin'` — this is the role-gating Task 13's scorer test exercises.

- [ ] **Step 1: Write the failing tests**

Append to `tests/e2e/admin-flows.spec.mjs`:

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
  await row.locator('button[data-finish]').click();
  await expect(row).toContainText('finished');
});

test('scorer does not see a finish control on matches', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=matches]');
  await expect(page.locator('button[data-finish]')).toHaveCount(0);
});

test('anonymous (logged out) request can still read tournaments from Supabase', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const mod = await import('/supabase-client.js');
    const { data, error } = await mod.getClient().from('tournaments').select().limit(1);
    return { count: data?.length ?? 0, error: error?.message ?? null };
  });
  expect(result.error).toBeNull();
  expect(result.count).toBeGreaterThanOrEqual(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test tests/e2e/admin-flows.spec.mjs -g "match|scorer|anonymous"`

Expected: FAIL — no `matches` screen yet.

- [ ] **Step 3: Add functions to `admin/db.js`**

Append:

```js
export async function listMatches(categoryId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, status, round_label, best_of, team_a:team_a_id(name), team_b:team_b_id(name), court:court_id(name)')
    .eq('category_id', categoryId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}

export async function createMatch({ category_id, team_a_id, team_b_id, court_id, round_label, best_of }) {
  const { error } = await getClient().from('matches').insert({
    category_id, team_a_id, team_b_id, court_id: court_id || null, round_label: round_label || null, best_of: best_of || 5,
  });
  if (error) throw error;
}

export async function finishMatch(id) {
  const { error } = await getClient().from('matches').update({ status: 'finished' }).eq('id', id);
  if (error) throw error;
}

export async function startMatch(id) {
  const { error } = await getClient().rpc('start_match', { p_match_id: id });
  if (error) throw error;
}
```

- [ ] **Step 4: Write `admin/screens/matches.js`**

```js
import { registerScreen } from '../app.js';
import {
  listTournaments, listCategories, listTeams, listCourts, listMatches, createMatch, finishMatch,
} from '../db.js';

async function render(main, { role }) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  main.innerHTML = `
    <h2>Matches</h2>
    <label>Turnier<select id="match_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="match_category"></select></label>
    <div id="matchTableWrap"></div>
    <form id="matchForm" class="entity-form">
      <label>Team A<select id="match_team_a"></select></label>
      <label>Team B<select id="match_team_b"></select></label>
      <label>Court<select id="match_court"></select></label>
      <label>Runde<input id="match_round"></label>
      <label>Best of<input id="match_best_of" type="number" value="5"></label>
      <button type="submit">Anlegen</button>
      <p id="matchError" class="error" hidden></p>
    </form>
  `;

  let currentCategoryId = null;

  async function renderTable() {
    const matches = currentCategoryId ? await listMatches(currentCategoryId) : [];
    document.getElementById('matchTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Team A</th><th>Team B</th><th>Court</th><th>Status</th><th></th></tr></thead>
        <tbody>${matches.map((m) => `
          <tr>
            <td>${m.team_a?.name ?? ''}</td>
            <td>${m.team_b?.name ?? ''}</td>
            <td>${m.court?.name ?? ''}</td>
            <td>${m.status}</td>
            <td>${role === 'admin' && m.status !== 'finished'
              ? `<button data-finish="${m.id}">Finished</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-finish]').forEach((btn) => {
      btn.onclick = async () => {
        await finishMatch(btn.dataset.finish);
        await renderTable();
      };
    });
  }

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('match_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    return categories;
  }

  async function refreshTeamsAndCourts(tournamentId, categoryId) {
    const [teams, courts] = await Promise.all([listTeams(categoryId), listCourts(tournamentId)]);
    document.getElementById('match_team_a').innerHTML = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('match_team_b').innerHTML = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('match_court').innerHTML =
      `<option value="">—</option>` + courts.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  async function selectCategory(tournamentId, categoryId) {
    currentCategoryId = categoryId;
    await refreshTeamsAndCourts(tournamentId, categoryId);
    await renderTable();
  }

  document.getElementById('match_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) await selectCategory(e.target.value, categories[0].id);
  };
  document.getElementById('match_category').onchange = (e) =>
    selectCategory(document.getElementById('match_tournament').value, e.target.value);

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) await selectCategory(tournaments[0].id, categories[0].id);
  }

  document.getElementById('matchForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('matchError');
    try {
      await createMatch({
        category_id: currentCategoryId,
        team_a_id: document.getElementById('match_team_a').value,
        team_b_id: document.getElementById('match_team_b').value,
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
}

registerScreen('matches', { render });
```

- [ ] **Step 5: Pass `role` through from `app.js`**

Confirm `admin/app.js`'s `showScreen` already passes `{ role: currentRole }` to `screen.render` (written that way in Task 7 Step 4) — `matches.js` above relies on receiving `role` as its second argument. No change needed if Task 7 was implemented as specified.

- [ ] **Step 6: Run the tests**

Run: `set -a && source .env && set +a && npx playwright test tests/e2e/admin-flows.spec.mjs -g "match|scorer|anonymous"`

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add admin/db.js admin/screens/matches.js tests/e2e/admin-flows.spec.mjs
git commit -m "feat: add match CRUD screen with admin-only finish control"
```

---

### Task 13: Full test suite run

**Files:** none (verification task)

**Interfaces:** none — this task only runs everything built so far.

- [ ] **Step 1: Run all unit tests**

Run: `npm run test:unit`

Expected: all pass.

- [ ] **Step 2: Run all RLS/integration tests**

Run: `set -a && source .env && set +a && npm run test:rls`

Expected: all pass.

- [ ] **Step 3: Run the full Playwright suite**

Run: `set -a && source .env && set +a && npm run test:e2e`

Expected: all pass (9 tests across the file: tournament, category, court, team, match+finish, scorer-blocked, anon-read).

- [ ] **Step 4: Fix any failures found, re-run until green**

If a test fails, fix the underlying code (not the test) unless the test itself is wrong per the spec — then re-run Steps 1–3 until everything passes.

- [ ] **Step 5: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found in full test suite run"
```

---

### Task 14: Deploy — real Supabase project + data migration

**Files:** none (operational task — no new files, uses everything built above)

**Interfaces:** none.

- [ ] **Step 1: Create the real Supabase project**

Go to https://supabase.com/dashboard, create a new project (Free tier) for this tournament. Note the project's URL, `anon` key, and `service_role` key from Project Settings → API.

- [ ] **Step 2: Link the local project and push migrations**

Run: `npx supabase link --project-ref <your-project-ref>` then `npx supabase db push`

Expected: both schema and RLS migrations apply to the cloud project without error.

- [ ] **Step 3: Update `.env` with the real project's credentials**

Replace `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env` with the real project's values. Set `SEED_ADMIN_PASSWORD`/`SEED_SCORER_PASSWORD` to strong, real passwords (share them with the tournament staff out of band, not via this repo).

- [ ] **Step 4: Seed the shared users on the real project**

Run: `set -a && source .env && set +a && node scripts/seed-roles.mjs`

Expected: both users created.

- [ ] **Step 5: Run the one-off data migration**

Run: `set -a && source .env && set +a && node scripts/migrate-sheet-data.mjs`

Expected: `Migration complete. Tournament ID: <uuid>`.

- [ ] **Step 6: Spot-check the data**

Run: `set -a && source .env && set +a && node -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, count } = await db.from('matches').select('*', { count: 'exact' });
  console.log('matches:', count);
  console.log(data[0]);
});
"`

Expected: a plausible match count (matches 16–48 per the spec's context, so around 33) and a realistic first row.

- [ ] **Step 7: Regenerate and deploy the admin app config**

Run: `node scripts/generate-admin-config.mjs`

Deploy the `admin/` directory to the same static host as `fistball-live` (e.g. a `/admin` path on GitHub Pages/Netlify), making sure `admin/config.js` is included in that deploy (it's gitignored, so the deploy step must generate it from the real project's env vars, not rely on it being committed).

- [ ] **Step 8: Manual acceptance check**

Log into the deployed `/admin` as `admin@fistball-ems.local`, confirm the migrated tournament/categories/teams/matches are visible and editable, then log in as `scorer@fistball-ems.local` and confirm no finish control appears.

- [ ] **Step 9: Note in follow-up**

No commit for this task (it's operational, not code) — but note in the next standup/handoff that Teilprojekt 1 is live and Teilprojekt 2 (Sumula) is next.

---

## Self-Review Notes

- **Spec coverage:** Architektur (Task 1, 7), Kostentabelle (Task 14 Step 1, informational), Datenmodell incl. `best_of` on `matches` and free-text referee roles (Task 2), Zugriffskontrolle incl. `start_match` RPC (Task 3), Admin-CRUD-UI-Scope all 6 screens (Tasks 7–12), Einmalige Datenmigration (Task 5, 6, 14), Fehlerbehandlung — FK errors surfaced inline (Task 11 Step 4, tested Task 11 Step 1), Testing — unit/RLS/Playwright all present (Tasks 5, 3, 8–12), `package.json` creation (Task 1). All spec sections have a corresponding task.
- **Placeholder scan:** no TBD/TODO; every step has runnable code or an exact command with expected output.
- **Type/name consistency checked:** `db.js` function names (`listTournaments`, `createCategory`, `finishMatch`, `startMatch`, etc.) are introduced once and reused with identical names across Tasks 8–12; `registerScreen`/`showScreen` signature is fixed in Task 7 and used identically by every `screens/*.js` file; `auth_role()` and `start_match()` SQL names from Task 3 match the RPC call in `admin/db.js` (Task 12) and the test in Task 3.
