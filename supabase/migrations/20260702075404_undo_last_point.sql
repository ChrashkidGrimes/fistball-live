create or replace function public.undo_last_point(p_match_id uuid, p_set_number integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_set sets%rowtype;
  v_last_event point_events%rowtype;
begin
  v_match := public.get_live_match(p_match_id);

  select * into v_set from sets where match_id = p_match_id and set_number = p_set_number for update;
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
