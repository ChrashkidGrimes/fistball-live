-- Base table GRANTs needed because auto_expose_new_tables is off: PostgREST requires explicit table-level privilege before RLS policies are evaluated.

-- SELECT access for anon and authenticated on all data tables.
grant select on public.tournaments to anon;
grant select on public.categories to anon;
grant select on public.courts to anon;
grant select on public.teams to anon;
grant select on public.matches to anon;
grant select on public.sets to anon;
grant select on public.point_events to anon;
grant select on public.referee_assignments to anon;

grant select on public.tournaments to authenticated;
grant select on public.categories to authenticated;
grant select on public.courts to authenticated;
grant select on public.teams to authenticated;
grant select on public.matches to authenticated;
grant select on public.sets to authenticated;
grant select on public.point_events to authenticated;
grant select on public.referee_assignments to authenticated;

-- Full CRUD for authenticated on master-data tables (RLS policies restrict to admin role only).
grant insert, update, delete on public.tournaments to authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.courts to authenticated;
grant insert, update, delete on public.teams to authenticated;
grant insert, update, delete on public.matches to authenticated;
grant insert, update, delete on public.referee_assignments to authenticated;

-- INSERT and UPDATE for authenticated on sets and point_events (RLS policies restrict to scorer role only).
grant insert, update on public.sets to authenticated;
grant insert, update on public.point_events to authenticated;

-- SELECT on user_roles for authenticated (needed for "read own role" RLS policy to work).
grant select on public.user_roles to authenticated;
