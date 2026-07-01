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
