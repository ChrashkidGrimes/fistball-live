import { createClient } from '../vendor/supabase-js-2.110.0.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getClient() {
  return client;
}

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error;
}

export async function signOut() {
  await client.auth.signOut();
}

export async function getSessionRole() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  const { data, error } = await client.from('user_roles').select('role').eq('user_id', session.user.id).single();
  if (error) return null;
  return data.role;
}
