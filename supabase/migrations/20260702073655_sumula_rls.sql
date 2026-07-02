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
