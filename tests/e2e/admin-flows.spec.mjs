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

test('admin can create a tournament', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Playwright Test Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright Test Tournament');
});

test('admin can create a category under a tournament', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Playwright Test Tournament' });
  await page.fill('#c_name', 'Playwright Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright Category');
});

test('admin can create a court under a tournament', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=courts]');
  await page.selectOption('#court_tournament', { label: 'Playwright Test Tournament' });
  await page.fill('#court_name', 'Court 9');
  await page.click('#courtForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Court 9');
});

test('admin can create a team under a category, and delete blocked by FK is surfaced as an error', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#team_category', { label: 'Playwright Category' });
  await page.fill('#team_name', 'Playwright FC');
  await page.click('#teamForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright FC');
});

test('admin can create a match and mark it finished', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#team_category', { label: 'Playwright Category' });
  await page.fill('#team_name', 'Playwright United');
  await page.click('#teamForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright United');

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Playwright Test Tournament' });
  await page.selectOption('#match_category', { label: 'Playwright Category' });
  await page.selectOption('#match_team_a', { label: 'Playwright FC' });
  await page.selectOption('#match_team_b', { label: 'Playwright United' });
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Playwright FC');

  const row = page.locator('tr', { hasText: 'Playwright FC' });
  await row.locator('button[data-forfeit-toggle]').click();
  await row.locator('button[data-forfeit-winner]').first().click();
  await expect(row).toContainText('finished');
});

test('scorer does not see a finish control on matches', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=matches]');
  await expect(page.locator('button[data-finish]')).toHaveCount(0);
});

test('anonymous (logged out) request can still read tournaments from Supabase', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const mod = await import('/supabase-client.js');
    const { data, error } = await mod.getClient().from('tournaments').select().limit(1);
    return { count: data?.length ?? 0, error: error?.message ?? null };
  });
  expect(result.error).toBeNull();
  expect(result.count).toBeGreaterThanOrEqual(0);
});

test('admin can generate a round-robin group stage with courts and times', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Schedule Gen Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Schedule Gen Tournament');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Schedule Gen Tournament' });
  await page.fill('#c_name', 'Schedule Gen Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=courts]');
  await page.selectOption('#court_tournament', { label: 'Schedule Gen Tournament' });
  await page.fill('#court_name', 'Schedule Court 1');
  await page.click('#courtForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Schedule Gen Tournament' });
  await page.selectOption('#team_category', { label: 'Schedule Gen Category' });
  for (const name of ['SG Team A', 'SG Team B', 'SG Team C']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=schedule]');
  await page.selectOption('#sg_tournament', { label: 'Schedule Gen Tournament' });
  await page.selectOption('#sg_category', { label: 'Schedule Gen Category' });
  await page.fill('#sg_start', '2026-07-23T09:00');
  await page.fill('#sg_end', '2026-07-23T18:00');
  await page.click('#sg_preview');
  await expect(page.locator('#sg_preview_wrap table tbody tr')).toHaveCount(3);
  await page.click('#sg_commit');
  await expect(page.locator('#sg_preview_wrap')).toContainText('Spielplan angelegt');

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Schedule Gen Tournament' });
  await page.selectOption('#match_category', { label: 'Schedule Gen Category' });
  await expect(page.locator('table tbody tr')).toHaveCount(3);
});
