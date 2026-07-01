import { getClient } from './supabase-client.js';

export async function listTournaments() {
  const { data, error } = await getClient().from('tournaments').select().order('start_date');
  if (error) throw error;
  return data;
}

export async function createTournament({ name, start_date, end_date }) {
  const { error } = await getClient().from('tournaments').insert({ name, start_date, end_date });
  if (error) throw error;
}

export async function updateTournament(id, { name, start_date, end_date }) {
  const { error } = await getClient().from('tournaments').update({ name, start_date, end_date }).eq('id', id);
  if (error) throw error;
}

export async function listCategories(tournamentId) {
  const { data, error } = await getClient().from('categories').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createCategory({ tournament_id, name, format }) {
  const { error } = await getClient().from('categories').insert({ tournament_id, name, format });
  if (error) throw error;
}

export async function listCourts(tournamentId) {
  const { data, error } = await getClient().from('courts').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createCourt({ tournament_id, name }) {
  const { error } = await getClient().from('courts').insert({ tournament_id, name });
  if (error) throw error;
}

export async function listTeams(categoryId) {
  const { data, error } = await getClient().from('teams').select().eq('category_id', categoryId).order('name');
  if (error) throw error;
  return data;
}

export async function createTeam({ category_id, name, short_name }) {
  const { error } = await getClient().from('teams').insert({ category_id, name, short_name: short_name || null });
  if (error) throw error;
}

export async function deleteTeam(id) {
  const { error } = await getClient().from('teams').delete().eq('id', id);
  if (error) throw error;
}
