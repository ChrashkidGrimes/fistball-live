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

test('admin can set up a tournament and add a player to the roster', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=tournaments]');
  await page.fill('#t_name', 'Game Report Test Tournament');
  await page.fill('#t_start', '2026-07-23');
  await page.fill('#t_end', '2026-07-26');
  await page.click('#tournamentForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Game Report Test Tournament');

  await page.click('button[data-screen=categories]');
  await page.selectOption('#c_tournament', { label: 'Game Report Test Tournament' });
  await page.fill('#c_name', 'Game Report Category');
  await page.selectOption('#c_format', 'round_robin');
  await page.click('#categoryForm button[type=submit]');

  await page.click('button[data-screen=teams]');
  await page.selectOption('#team_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#team_category', { label: 'Game Report Category' });
  await page.fill('#team_name', 'Game Report Team A');
  await page.click('#teamForm button[type=submit]');
  await page.fill('#team_name', 'Game Report Team B');
  await page.click('#teamForm button[type=submit]');

  await page.click('button[data-screen=players]');
  await page.selectOption('#player_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#player_category', { label: 'Game Report Category' });
  await page.selectOption('#player_team', { label: 'Game Report Team A' });
  await page.fill('#player_family_name', 'Mustermann');
  await page.fill('#player_given_name', 'Max');
  await page.fill('#player_jersey_number', '7');
  await page.click('#playerForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Max Mustermann');
});
