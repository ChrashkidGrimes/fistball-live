create or replace function public.record_timeout(p_match_id uuid, p_set_number integer, p_team text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match matches%rowtype;
  v_set sets%rowtype;
begin
  if p_team not in ('a', 'b') then
    raise exception 'invalid team: %', p_team;
  end if;

  v_match := public.get_live_match(p_match_id);

  select * into v_set from sets where match_id = p_match_id and set_number = p_set_number for update;
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
