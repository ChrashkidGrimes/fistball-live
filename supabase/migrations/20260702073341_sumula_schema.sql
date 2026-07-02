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
