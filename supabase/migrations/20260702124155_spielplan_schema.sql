alter table matches alter column team_a_id drop not null;
alter table matches alter column team_b_id drop not null;

alter table matches add column team_a_source_match_id uuid references matches(id) on delete restrict;
alter table matches add column team_a_source_outcome text check (team_a_source_outcome in ('winner', 'loser'));
alter table matches add column team_b_source_match_id uuid references matches(id) on delete restrict;
alter table matches add column team_b_source_outcome text check (team_b_source_outcome in ('winner', 'loser'));
alter table matches add column winner_team_id uuid references teams(id) on delete set null;

alter table matches add constraint team_a_fixed_xor_source
  check ((team_a_id is not null) <> (team_a_source_match_id is not null));
alter table matches add constraint team_b_fixed_xor_source
  check ((team_b_id is not null) <> (team_b_source_match_id is not null));
