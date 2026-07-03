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
