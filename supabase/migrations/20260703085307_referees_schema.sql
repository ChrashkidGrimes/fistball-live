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
grant select on public.referees to anon;
grant select on public.referees to authenticated;
grant insert, update, delete on public.referees to authenticated;

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
