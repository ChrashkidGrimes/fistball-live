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

grant select, insert, update, delete on public.tournaments to service_role;
grant select, insert, update, delete on public.categories to service_role;
grant select, insert, update, delete on public.courts to service_role;
grant select, insert, update, delete on public.teams to service_role;
grant select, insert, update, delete on public.matches to service_role;
grant select, insert, update, delete on public.sets to service_role;
grant select, insert, update, delete on public.point_events to service_role;
grant select, insert, update, delete on public.referee_assignments to service_role;
grant select, insert, update, delete on public.user_roles to service_role;
