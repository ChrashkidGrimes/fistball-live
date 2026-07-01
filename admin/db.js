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
