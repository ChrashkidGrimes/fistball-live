import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;

for (const [name, value] of Object.entries({
  SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  SEED_ADMIN_PASSWORD: adminPassword, SEED_SCORER_PASSWORD: scorerPassword,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name} (see .env.example)`);
    process.exit(1);
  }
}

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function upsertUser(email, password, role) {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`created auth user: ${email}`);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    console.log(`updated password for existing user: ${email}`);
  }
  const { error: roleError } = await supabase
    .from('user_roles')
    .upsert({ user_id: user.id, role }, { onConflict: 'user_id' });
  if (roleError) throw roleError;
  console.log(`role '${role}' assigned to ${email}`);
}

await upsertUser('admin@fistball-ems.local', adminPassword, 'admin');
await upsertUser('scorer@fistball-ems.local', scorerPassword, 'scorer');
