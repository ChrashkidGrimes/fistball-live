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

  await page.selectOption('#ctx_tournament', { label: 'Referees Assign Tournament' });
  await page.click('button[data-screen=categories]');
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

test('admin can auto-assign referees for a category and commit the preview', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Auto Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.selectOption('#ctx_tournament', { label: 'Referees Auto Tournament' });
  await page.click('button[data-screen=categories]');
  await page.fill('#c_name', 'Referees Auto Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=courts]');
  await page.fill('#court_name', 'Referees Auto Court');
  await page.click('#courtForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Referees Auto Tournament' });
  await page.selectOption('#team_category', { label: 'Referees Auto Category' });
  for (const name of ['RA Team A', 'RA Team B']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=schedule]');
  await page.selectOption('#sg_tournament', { label: 'Referees Auto Tournament' });
  await page.selectOption('#sg_category', { label: 'Referees Auto Category' });
  await page.fill('#sg_start', '2026-07-23T09:00');
  await page.fill('#sg_end', '2026-07-23T18:00');
  await page.click('#sg_preview');
  await expect(page.locator('#sg_preview_wrap table tbody tr')).toHaveCount(1);
  await page.click('#sg_commit');
  await expect(page.locator('#sg_preview_wrap')).toContainText('Spielplan angelegt');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Auto Tournament' });
  for (const name of ['Auto Ref One', 'Auto Ref Two']) {
    await page.fill('#ref_name', name);
    await page.fill('#ref_country', 'Neutralia');
    await page.click('#refForm button[type=submit]');
    await expect(page.locator('#refTableWrap table tbody')).toContainText(name);
  }

  await page.locator('#auto_roles input[value="Recording Clerk"]').check();
  for (const role of ['1st Referee', '2nd Referee', 'Assistant Referee 1', 'Assistant Referee 2']) {
    await page.locator(`#auto_roles input[value="${role}"]`).uncheck();
  }
  await page.click('#auto_preview');
  await expect(page.locator('#auto_preview_wrap table tbody tr')).toHaveCount(1);
  await expect(page.locator('#auto_preview_wrap table tbody')).toContainText('Recording Clerk');
  await page.click('#auto_commit');
  await expect(page.locator('#auto_preview_wrap')).toContainText('Zuweisungen angelegt');
});

test('workload overview shows the correct total after an assignment', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Referees Workload Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');

  await page.selectOption('#ctx_tournament', { label: 'Referees Workload Tournament' });
  await page.click('button[data-screen=categories]');
  await page.fill('#c_name', 'Referees Workload Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Referees Workload Tournament' });
  await page.selectOption('#team_category', { label: 'Referees Workload Category' });
  for (const name of ['RW Team A', 'RW Team B']) {
    await page.fill('#team_name', name);
    await page.click('#teamForm button[type=submit]');
    await expect(page.locator('table tbody')).toContainText(name);
  }

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Referees Workload Tournament' });
  await page.selectOption('#match_category', { label: 'Referees Workload Category' });
  await page.selectOption('#match_team_a', { label: 'RW Team A' });
  await page.selectOption('#match_team_b', { label: 'RW Team B' });
  await page.fill('#match_round', 'RW Match');
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('RW Match');

  await page.click('button[data-screen=referees]');
  await page.selectOption('#ref_tournament', { label: 'Referees Workload Tournament' });
  await page.fill('#ref_name', 'Workload Ref');
  await page.fill('#ref_country', 'Neutralia');
  await page.click('#refForm button[type=submit]');
  await expect(page.locator('#workloadWrap table tbody')).toContainText('Workload Ref');
  await expect(page.locator('#workloadWrap table tbody tr', { hasText: 'Workload Ref' })).toContainText('0');

  await page.selectOption('#assign_category', { label: 'Referees Workload Category' });
  await page.selectOption('#assign_match', { label: 'RW Match (RW Team A vs RW Team B)' });
  await page.selectOption('#assign_referee', { label: 'Workload Ref (Neutralia)' });
  await page.selectOption('#assign_role_select', '1st Referee');
  await page.click('#assignForm button[type=submit]');
  await expect(page.locator('#assignmentsWrap table tbody')).toContainText('Workload Ref');

  const workloadRow = page.locator('#workloadWrap table tbody tr', { hasText: 'Workload Ref' });
  await expect(workloadRow.locator('td').nth(2)).toHaveText('1');
});
