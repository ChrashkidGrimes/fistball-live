import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;
for (const [k, v] of Object.entries({ url, anonKey, serviceKey, adminPassword, scorerPassword })) {
  if (!v) throw new Error(`Missing env var for ${k} — see .env.example`);
}

const service = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, refereeAId, refereeBId, matchAId, matchBId, admin, scorer;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Referees Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Referees Schema Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Referees Schema Team A' },
    { category_id: categoryId, name: 'Referees Schema Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const referees = await service.from('referees').insert([
    { tournament_id: tournamentId, name: 'Referees Schema Ref A', country: 'Switzerland' },
    { tournament_id: tournamentId, name: 'Referees Schema Ref B', country: 'Austria' },
  ]).select();
  refereeAId = referees.data[0].id;
  refereeBId = referees.data[1].id;
  const matches = await service.from('matches').insert([
    { category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999600, scheduled_time: '2026-07-23T10:00:00Z' },
    { category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999601, scheduled_time: '2026-07-23T13:00:00Z' },
  ]).select();
  matchAId = matches.data[0].id;
  matchBId = matches.data[1].id;

  admin = createClient(url, anonKey);
  await admin.auth.signInWithPassword({ email: 'admin@fistball-ems.local', password: adminPassword });
  scorer = createClient(url, anonKey);
  await scorer.auth.signInWithPassword({ email: 'scorer@fistball-ems.local', password: scorerPassword });
});

after(async () => {
  await service.from('referee_assignments').delete().in('match_id', [matchAId, matchBId]);
  await service.from('matches').delete().in('id', [matchAId, matchBId]);
  await service.from('referees').delete().in('id', [refereeAId, refereeBId]);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

test('unique(tournament_id, name) is enforced on referees', async () => {
  const { error } = await service.from('referees').insert({
    tournament_id: tournamentId, name: 'Referees Schema Ref A', country: 'Germany',
  });
  assert.ok(error, 'expected a unique constraint violation');
});

test('referee_assignments requires a valid referee_id (FK enforced)', async () => {
  const { error } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: '00000000-0000-0000-0000-000000000000', role: '1st Referee',
  });
  assert.ok(error, 'expected a foreign key violation error');
});

test('deleting a referenced referee is blocked (on delete restrict)', async () => {
  const { data: a } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();
  const { error } = await service.from('referees').delete().eq('id', refereeAId);
  assert.ok(error, 'expected a foreign key violation error');
  await service.from('referee_assignments').delete().eq('id', a.id);
});

test('the double-booking trigger blocks a second assignment at the same scheduled_time', async () => {
  const { data: first, error: firstError } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();
  assert.equal(firstError, null);

  const { error: secondError } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '2nd Referee',
  });
  assert.ok(secondError, 'expected the trigger to reject a second assignment of the same referee to the same match');

  await service.from('referee_assignments').delete().eq('id', first.id);
});

test('the double-booking trigger allows the same referee at a different scheduled_time', async () => {
  const { data: first } = await service.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();

  const { data: second, error } = await service.from('referee_assignments').insert({
    match_id: matchBId, referee_id: refereeAId, role: '1st Referee',
  }).select().single();
  assert.equal(error, null);

  await service.from('referee_assignments').delete().in('id', [first.id, second.id]);
});

test('scorer cannot write to referees or referee_assignments', async () => {
  const { error: refError } = await scorer.from('referees').insert({
    tournament_id: tournamentId, name: 'Should Fail', country: 'Nowhere',
  });
  assert.ok(refError, 'expected scorer to be rejected writing referees');

  const { error: assignError } = await scorer.from('referee_assignments').insert({
    match_id: matchAId, referee_id: refereeBId, role: '1st Referee',
  });
  assert.ok(assignError, 'expected scorer to be rejected writing referee_assignments');
});

test('admin can create and read a referee', async () => {
  const { data, error } = await admin.from('referees').select().eq('id', refereeBId).single();
  assert.equal(error, null);
  assert.equal(data.country, 'Austria');
});
