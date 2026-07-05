import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@fistball-ems.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function loginAs(page, email, password) {
  await page.goto('./');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#loginForm button[type=submit]');
  await expect(page.locator('#appView')).toBeVisible();
}

test('a KO match with a "winner of" source auto-resolves once the source match is finished', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'KO Source Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.selectOption('#ctx_tournament', { label: 'KO Source Tournament' });
  await page.click('button[data-screen=categories]');
  await page.fill('#c_name', 'KO Source Category');
  await page.selectOption('#c_format', 'knockout');
  await page.click('#categoryForm button[type=submit]');

  await page.selectOption('#ctx_tournament', { label: 'KO Source Tournament' });
  await page.selectOption('#ctx_category', { label: 'KO Source Category' });
  await page.click('button[data-screen=teams]');
  for (const name of ['KO Team A', 'KO Team B', 'KO Team C']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.selectOption('#ctx_tournament', { label: 'KO Source Tournament' });
  await page.selectOption('#ctx_category', { label: 'KO Source Category' });
  await page.click('button[data-screen=matches]');
  // No explicit wait needed here: matches.js disables the team/court/source
  // selects for the duration of each tournament/category refresh chain, so
  // Playwright's own actionability checks make the selectOption() calls below
  // wait for the in-flight refresh to finish before interacting, instead of
  // racing against it. (The matches screen has no category select of its
  // own — category comes from the shared context bar.)

  // Source match: KO Team A vs KO Team B (fixed teams).
  await page.selectOption('#match_team_a', { label: 'KO Team A' });
  await page.selectOption('#match_team_b', { label: 'KO Team B' });
  await page.fill('#match_round', 'Semi-final 1');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Semi-final 1');

  // Dependent match: team A slot = winner of the source match, team B = fixed KO Team C.
  // The source-match dropdown's rendered option label is built by refreshSourceOptions()
  // as `${label} (${teamAName} vs ${teamBName})`; since this match has no sheet_match_nr
  // (only set by the sheet migration script, not the UI form), label falls back to
  // round_label — so the exact rendered text is "Semi-final 1 (KO Team A vs KO Team B)".
  // selectOption's `label` option requires an exact string match, not a regex.
  await page.selectOption('#match_team_a_mode', 'winner');
  await page.selectOption('#match_team_a_source', { label: 'Semi-final 1 (KO Team A vs KO Team B)' });
  await page.selectOption('#match_team_b', { label: 'KO Team C' });
  await page.fill('#match_round', 'Final');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Sieger von');

  // Finish the source match via forfeit (KO Team A wins), then check resolution.
  const row = page.locator('tr', { hasText: 'KO Team A' }).filter({ hasText: 'KO Team B' });
  await row.locator('button[data-forfeit-toggle]').click();
  await row.locator('button[data-forfeit-winner]').first().click();
  await expect(row).toContainText('finished');

  await expect(page.locator('table tbody')).not.toContainText('Sieger von');
  const finalRow = page.locator('tr', { hasText: 'KO Team C' });
  await expect(finalRow).toContainText('KO Team A');
});
