import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'admin@fistball-ems.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function loginAs(page, email, password) {
  await page.goto('/');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#loginForm button[type=submit]');
  await expect(page.locator('#appView')).toBeVisible();
}

test('admin can create and delete a referee', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Test Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Referees Test Tournament');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Test Tournament' });
  await page.fill('#ref_name', 'Jane Referee');
  await page.fill('#ref_country', 'Switzerland');
  await page.click('#refForm button[type=submit]');
  await expect(page.locator('#refTableWrap table tbody')).toContainText('Jane Referee');
  await expect(page.locator('#refTableWrap table tbody')).toContainText('Switzerland');

  await page.click('[data-delete-ref]');
  await expect(page.locator('#refTableWrap table tbody')).not.toContainText('Jane Referee');
});

test('admin can manually assign a referee to a match and sees a same-country warning', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Assign Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Referees Assign Tournament' });
  await page.fill('#c_name', 'Referees Assign Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Referees Assign Tournament' });
  await page.selectOption('#team_category', { label: 'Referees Assign Category' });
  for (const name of ['Switzerland', 'Austria']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Referees Assign Tournament' });
  await page.selectOption('#match_category', { label: 'Referees Assign Category' });
  await page.selectOption('#match_team_a', { label: 'Switzerland' });
  await page.selectOption('#match_team_b', { label: 'Austria' });
  await page.fill('#match_round', 'Group Match 1');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Group Match 1');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Assign Tournament' });
  await page.fill('#ref_name', 'Swiss Ref');
  await page.fill('#ref_country', 'Switzerland');
  await page.click('#refForm button[type=submit]');
  await expect(page.locator('#refTableWrap table tbody')).toContainText('Swiss Ref');

  await page.selectOption('#assign_category', { label: 'Referees Assign Category' });
  await page.selectOption('#assign_match', { label: 'Group Match 1 (Switzerland vs Austria)' });
  await page.selectOption('#assign_referee', { label: 'Swiss Ref (Switzerland)' });
  await expect(page.locator('#assignConflictWarning')).toBeVisible();
  await expect(page.locator('#assignConflictWarning')).toContainText('Swiss Ref');

  await page.selectOption('#assign_role_select', '1st Referee');
  await page.click('#assignForm button[type=submit]');
  await expect(page.locator('#assignmentsWrap table tbody')).toContainText('Swiss Ref');
  await expect(page.locator('#assignmentsWrap table tbody')).toContainText('1st Referee');
});
