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
