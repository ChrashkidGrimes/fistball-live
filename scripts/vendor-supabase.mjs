// One-off vendoring: bundles the installed @supabase/supabase-js into a
// single self-contained ES module served same-origin (no esm.sh at runtime).
// Re-run after upgrading the package:  node scripts/vendor-supabase.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8'),
);
const out = `vendor/supabase-js-${pkg.version}.mjs`;
// Note: the brief's original entry path (dist/module/index.js) matches an
// older supabase-js dist layout. The installed 2.110.0 ships dist/index.mjs
// (see its package.json "module" field) — use that instead.
execFileSync('npx', [
  'esbuild', 'node_modules/@supabase/supabase-js/dist/index.mjs',
  '--bundle', '--format=esm', '--target=es2020', `--outfile=${out}`,
], { stdio: 'inherit' });
console.log(`Wrote ${out}`);
