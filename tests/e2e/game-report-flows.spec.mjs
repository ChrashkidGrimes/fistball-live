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

test('admin can select a match in Game Report and start it', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.click('button[data-screen=matches]');
  await page.selectOption('#match_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#match_category', { label: 'Game Report Category' });
  await page.selectOption('#match_team_a', { label: 'Game Report Team A' });
  await page.selectOption('#match_team_b', { label: 'Game Report Team B' });
  await page.click('#matchForm button[type=submit]');
  await expect(page.locator('table tbody')).toContainText('Game Report Team A');

  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });
  await expect(page.locator('#gameReportHeader')).toContainText('Game Report Team A');
  await expect(page.locator('#gameReportHeader')).toContainText('scheduled');

  await page.click('#startMatchBtn');
  await expect(page.locator('#gameReportHeader')).toContainText('live');
});

test('scorer can record points, tag a detail, use undo, and record a timeout', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });
  await expect(page.locator('#gameReportHeader')).toContainText('live');

  await page.click('#pointA');
  await page.click('#pointA');
  await expect(page.locator('#gr_score_a')).toHaveText('2');

  await page.click('#tagAceBtn');

  await page.click('#undoBtn');
  await expect(page.locator('#gr_score_a')).toHaveText('1');

  await page.click('#timeoutA');
  await expect(page.locator('#gr_timeouts_a')).toHaveText('1');
});

test('scorer can record a card for a player', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });

  await page.selectOption('#card_player', { label: 'Max Mustermann (#7)' });
  await page.selectOption('#card_type', 'Y');
  await page.click('#cardForm button[type=submit]');
  await expect(page.locator('#gr_cards_list')).toContainText('Max Mustermann');
  await expect(page.locator('#gr_cards_list')).toContainText('Y');
});

test('scorer can record a substitution', async ({ page }) => {
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.click('button[data-screen=players]');
  await page.selectOption('#player_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#player_category', { label: 'Game Report Category' });
  await page.selectOption('#player_team', { label: 'Game Report Team A' });
  await page.fill('#player_family_name', 'Ersatz');
  await page.fill('#player_given_name', 'Erik');
  await page.fill('#player_jersey_number', '12');
  await page.click('#playerForm button[type=submit]');
  await page.click('#logoutBtn');
  await page.waitForURL('/');
  await page.waitForSelector('#email');

  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });

  await page.selectOption('#sub_player_out', { label: 'Max Mustermann' });
  await page.selectOption('#sub_player_in', { label: 'Erik Ersatz' });
  await page.click('#subForm button[type=submit]');
  await expect(page.locator('#gr_subs_list')).toContainText('Max Mustermann');
  await expect(page.locator('#gr_subs_list')).toContainText('Erik Ersatz');
});

test('scorer can record an extraordinary event, and the decided-match banner appears', async ({ page }) => {
  await loginAs(page, 'scorer@fistball-ems.local', process.env.SEED_SCORER_PASSWORD);
  await page.click('button[data-screen=game-report]');
  await page.selectOption('#gr_tournament', { label: 'Game Report Test Tournament' });
  await page.selectOption('#gr_category', { label: 'Game Report Category' });

  await page.selectOption('#incident_type', 'other');
  await page.fill('#incident_note', 'Regenunterbrechung 5 Minuten');
  await page.click('#incidentForm button[type=submit]');
  await expect(page.locator('#gr_incidents_list')).toContainText('Regenunterbrechung');

  // Drive the match to a decided state. The fixture match has best_of=5, so
  // deciding it requires winning ceil(5/2)=3 sets, i.e. 33 points minimum (11
  // per set). Each #pointA click triggers a full re-render via selectMatch,
  // which naturally advances currentSetNumber once a set is won — so this
  // loop rolls from set 1 into set 2 and set 3 without any special handling.
  for (let i = 0; i < 33; i++) {
    await page.click('#pointA');
  }
  await expect(page.locator('#gr_decided_banner')).toBeVisible();
});
