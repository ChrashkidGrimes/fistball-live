import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)');

const db = createClient(url, serviceKey);
let tournamentId, categoryId, teamId, matchId, playerId;

before(async () => {
  const t = await db.from('tournaments').insert({
    name: 'Sumula Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await db.from('categories').insert({
    tournament_id: tournamentId, name: 'Sumula Schema Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await db.from('teams').insert([
    { category_id: categoryId, name: 'Sumula Schema Team A' },
    { category_id: categoryId, name: 'Sumula Schema Team B' },
  ]).select();
  teamId = teams.data[0].id;
  const m = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teams.data[0].id, team_b_id: teams.data[1].id, sheet_match_nr: 999300,
  }).select().single();
  matchId = m.data.id;
});

after(async () => {
  await db.from('player_events').delete().eq('match_id', matchId);
  await db.from('players').delete().eq('team_id', teamId);
  await db.from('matches').delete().eq('id', matchId);
  await db.from('categories').delete().eq('id', categoryId);
  await db.from('tournaments').delete().eq('id', tournamentId);
});

test('a player can be created for a team and referenced by a player_event', async () => {
  const { data: player, error } = await db.from('players').insert({
    team_id: teamId, family_name: 'Muster', given_name: 'Max', jersey_number: 7, role: 'player', player_position: 'Spiker',
  }).select().single();
  assert.equal(error, null);
  playerId = player.id;

  const { data: event, error: eventError } = await db.from('player_events').insert({
    match_id: matchId, player_id: playerId, event_type: 'Y',
  }).select().single();
  assert.equal(eventError, null);
  assert.equal(event.event_type, 'Y');
});

test('a player_event cannot reference a non-existent player (FK enforced)', async () => {
  const { error } = await db.from('player_events').insert({
    match_id: matchId, player_id: '00000000-0000-0000-0000-000000000000', event_type: 'Y',
  });
  assert.ok(error, 'expected a foreign key violation error');
});

test('deleting a player referenced by a player_event is blocked', async () => {
  const { error } = await db.from('players').delete().eq('id', playerId);
  assert.ok(error, 'expected a foreign key violation error');
});

test('sets has timeouts_a/timeouts_b defaulting to 0', async () => {
  const { data: set, error } = await db.from('sets').insert({
    match_id: matchId, set_number: 1,
  }).select().single();
  assert.equal(error, null);
  assert.equal(set.timeouts_a, 0);
  assert.equal(set.timeouts_b, 0);
  await db.from('sets').delete().eq('id', set.id);
});
