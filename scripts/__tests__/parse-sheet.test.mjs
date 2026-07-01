import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCSV, parseScheduleRow, mapStatus, parseTournamentConfig, buildMigrationPlan,
} from '../parse-sheet.mjs';

// Real (public) row shape, from the published 2026 U18 WC schedule sheet.
const SCHEDULE_CSV = [
  '"","","","2026 U18 World Championship & Womens EFA Championship R E S U L T S","","","","",""',
  '"","","","","","","","","","","","","1","1","1","2","2","2","3","3","3","","","","","","","","","","","","","","x","","","",""',
  '"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""',
  '"","","","","Team A","Team B","Round","Category","","","","","","","","","","","","","","","","","","","","","","","","","","","","","Status","Remarks"',
  '"Thursday - 23 Jul  2026","10:00","16","1","Chile - U18 M Silver","India - U18 M Silver","Qualification round","U18 M Silver","5","1","x","2","1","x","2","5","x","1","2","x","4","0","x","0","0","x","0","FALSE","x","","","x","","8","|","7","Finished",""',
].join('\n');

const CONFIG_CSV = [
  '"1) Event Information","","","","","3) Categories","","","4) Rounds","","","5) Courts","","6) Points"',
  '"","Event:","2026 U18 WC","","","Team","","","Round","","","","","3"',
  '"","Date:","23-26 Jul 2026","","","WEC","0","","Gold medal match","5","","1","","","","","","","","",""',
  '"","","","","","U18 M Silver","0","","Qualification round","5","","2","","","","","","","","",""',
].join('\n');

test('parseCSV splits quoted comma-separated rows', () => {
  const rows = parseCSV('"a","b,c"\n"d",""');
  assert.deepEqual(rows, [['a', 'b,c'], ['d', '']]);
});

test('mapStatus maps the 4 sheet statuses to the 3 EMS statuses', () => {
  assert.equal(mapStatus('Not Started'), 'scheduled');
  assert.equal(mapStatus('Starting'), 'live');
  assert.equal(mapStatus('In progress'), 'live');
  assert.equal(mapStatus('Finished'), 'finished');
});

test('parseScheduleRow extracts a real match row', () => {
  const rows = parseCSV(SCHEDULE_CSV);
  const row = parseScheduleRow(rows[4]);
  assert.equal(row.nr, 16);
  assert.equal(row.court, '1');
  assert.equal(row.teamA, 'Chile');
  assert.equal(row.teamB, 'India');
  assert.equal(row.round, 'Qualification round');
  assert.equal(row.category, 'U18 M Silver');
  assert.equal(row.bestOf, 5);
  assert.equal(row.setsA, 1);
  assert.equal(row.setsB, 2);
  assert.equal(row.status, 'Finished');
  assert.equal(row.day, 'Thursday - 23 Jul  2026');
  assert.equal(row.time, '10:00');
});

test('parseScheduleRow returns null for header/blank rows', () => {
  const rows = parseCSV(SCHEDULE_CSV);
  assert.equal(parseScheduleRow(rows[0]), null);
  assert.equal(parseScheduleRow(rows[3]), null);
});

test('parseTournamentConfig reads courts and rounds sections', () => {
  const cfg = parseTournamentConfig(CONFIG_CSV);
  assert.ok(Array.isArray(cfg.categories));
  assert.ok(cfg.categories.includes('WEC'));
  assert.ok(cfg.categories.includes('U18 M Silver'));
});

test('buildMigrationPlan deduplicates categories/courts/teams and builds matches', () => {
  const plan = buildMigrationPlan(SCHEDULE_CSV);
  assert.deepEqual(plan.categories, ['U18 M Silver']);
  assert.deepEqual(plan.courts, ['1']);
  assert.deepEqual(
    plan.teams.sort((a, b) => a.name.localeCompare(b.name)),
    [{ name: 'Chile', category: 'U18 M Silver' }, { name: 'India', category: 'U18 M Silver' }],
  );
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0].nr, 16);
  assert.equal(plan.matches[0].status, 'Finished');
  assert.equal(plan.matches[0].scheduledTimeIso, '2026-07-23T08:00:00.000Z');
});
