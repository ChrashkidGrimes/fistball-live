-- Shared validation used by every scoring RPC (record_point, tag_last_point,
-- undo_last_point in Task 4, record_timeout in Task 5): checks the caller's
-- role and that the match exists and is live, and returns the match row.
-- Deliberately NOT granted to `authenticated` — it's an internal building
-- block, only ever called from within another security definer function
-- (which runs as that function's owner, so no separate grant is needed for
-- those internal calls to succeed).
create or replace function public.get_live_match(p_match_id uuid)
returns matches
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
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

  return v_match;
end;
$$;

revoke all on function public.get_live_match(uuid) from public;

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
  if p_team not in ('a', 'b') then
    raise exception 'invalid team: %', p_team;
  end if;

  v_match := public.get_live_match(p_match_id);

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
  v_match := public.get_live_match(p_match_id);

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
