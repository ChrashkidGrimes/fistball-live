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
let tournamentId, categoryId, teamAId, teamBId, matchId;

before(async () => {
  // Requires Task 4's seed-roles.mjs to have already run against this stack.
  const t = await service.from('tournaments').insert({
    name: 'RLS Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'RLS Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'RLS Team A' },
    { category_id: categoryId, name: 'RLS Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999100,
  }).select().single();
  matchId = m.data.id;
});

after(async () => {
  await service.from('tournaments').delete().eq('id', tournamentId);
});

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign-in failed for ${email}: ${error?.message}`);
  return client;
}

test('anon can read matches', async () => {
  const anon = createClient(url, anonKey);
  const { data, error } = await anon.from('matches').select().eq('id', matchId);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

test('anon cannot insert a tournament', async () => {
  const anon = createClient(url, anonKey);
  const { error } = await anon.from('tournaments').insert({
    name: 'Should Fail', start_date: '2026-01-01', end_date: '2026-01-02',
  });
  assert.ok(error, 'expected RLS to reject the insert');
});

test('admin can set a match to finished', async () => {
  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { data, error } = await admin.from('matches')
    .update({ status: 'finished' }).eq('id', matchId).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].status, 'finished');
  await service.from('matches').update({ status: 'scheduled' }).eq('id', matchId);
});

test('scorer cannot directly update a match', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data, error } = await scorer.from('matches')
    .update({ status: 'finished' }).eq('id', matchId).select();
  assert.equal(error, null);
  assert.equal(data.length, 0, 'scorer should not be able to touch any row');
  const check = await service.from('matches').select('status').eq('id', matchId).single();
  assert.equal(check.data.status, 'scheduled');
});

test('scorer can start a match via start_match()', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { error } = await scorer.rpc('start_match', { p_match_id: matchId });
  assert.equal(error, null);
  const check = await service.from('matches').select('status').eq('id', matchId).single();
  assert.equal(check.data.status, 'live');
  await service.from('matches').update({ status: 'scheduled' }).eq('id', matchId);
});

test('scorer can insert a set, admin cannot', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data, error } = await scorer.from('sets')
    .insert({ match_id: matchId, set_number: 1, points_a: 11, points_b: 5 }).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);

  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { error: adminError } = await admin.from('sets')
    .insert({ match_id: matchId, set_number: 2, points_a: 11, points_b: 5 });
  assert.ok(adminError, 'admin should not be able to insert sets');

  await service.from('sets').delete().eq('match_id', matchId);
});
