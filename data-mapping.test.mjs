import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIEBREAKERS, DEFAULT_RULES, statusLabel, sourceLabel, isRealTeam,
  mapMatch, mapCautions, rulesFromConfig,
} from './data-mapping.js';

test('statusLabel maps the 3 Supabase statuses to the 3 sheet-style display strings', () => {
  assert.equal(statusLabel('scheduled'), 'Not Started');
  assert.equal(statusLabel('live'), 'In progress');
  assert.equal(statusLabel('finished'), 'Finished');
});

test('sourceLabel returns a dash for a null source match', () => {
  assert.equal(sourceLabel(null, 'winner'), '—');
});

test('sourceLabel prefers sheet_match_nr over round_label, in German winner/loser phrasing', () => {
  assert.equal(sourceLabel({ sheet_match_nr: 52, round_label: 'Semi-final 1' }, 'winner'), 'Sieger von #52');
  assert.equal(sourceLabel({ sheet_match_nr: 52, round_label: 'Semi-final 1' }, 'loser'), 'Verlierer von #52');
});

test('sourceLabel falls back to round_label when sheet_match_nr is missing', () => {
  assert.equal(sourceLabel({ sheet_match_nr: null, round_label: 'Semi-final 1' }, 'winner'), 'Sieger von Semi-final 1');
});

test('isRealTeam recognizes the new German placeholder prefixes as not-real', () => {
  assert.equal(isRealTeam('Sieger von #52'), false);
  assert.equal(isRealTeam('Verlierer von Semi-final 1'), false);
  assert.equal(isRealTeam('Switzerland'), true);
  assert.equal(isRealTeam(''), false);
  assert.equal(isRealTeam(null), false);
});

test('mapMatch builds the standings-ready shape for a resolved, finished match with sets', () => {
  const row = {
    id: 'match-uuid-1', sheet_match_nr: 16, round_label: 'Qualification round',
    best_of: 5, status: 'finished', scheduled_time: '2026-07-23T10:30:00Z',
    team_a_id: 'team-a', team_b_id: 'team-b',
    team_a_source_outcome: null, team_b_source_outcome: null,
    team_a: { name: 'Chile' }, team_b: { name: 'India' },
    team_a_source_match: null, team_b_source_match: null,
    court: { name: '1' },
    categories: { name: 'U18 M Silver' },
    sets: [
      { set_number: 1, points_a: 11, points_b: 5, winner_team_id: 'team-a' },
      { set_number: 2, points_a: 9, points_b: 11, winner_team_id: 'team-b' },
      { set_number: 3, points_a: 11, points_b: 8, winner_team_id: 'team-a' },
    ],
  };
  const m = mapMatch(row);
  assert.equal(m.nr, 16);
  assert.equal(m.court, '1');
  assert.equal(m.teamA, 'Chile');
  assert.equal(m.teamB, 'India');
  assert.equal(m.round, 'Qualification round');
  assert.equal(m.category, 'U18 M Silver');
  assert.equal(m.bestOf, 5);
  assert.equal(m.setsA, 2);
  assert.equal(m.setsB, 1);
  assert.equal(m.pointsA, 31);
  assert.equal(m.pointsB, 24);
  assert.deepEqual(m.sets, [[11, 5], [9, 11], [11, 8]]);
  assert.equal(m.status, 'Finished');
});

test('mapMatch renders a "Sieger von" placeholder for an unresolved KO slot', () => {
  const row = {
    id: 'match-uuid-2', sheet_match_nr: 60, round_label: 'Final',
    best_of: 5, status: 'scheduled', scheduled_time: null,
    team_a_id: null, team_b_id: 'team-c',
    team_a_source_outcome: 'winner', team_b_source_outcome: null,
    team_a: null, team_b: { name: 'Kenya' },
    team_a_source_match: { sheet_match_nr: 52, round_label: 'Semi-final 1' },
    team_b_source_match: null,
    court: null,
    categories: { name: 'U18 Men' },
    sets: [],
  };
  const m = mapMatch(row);
  assert.equal(m.teamA, 'Sieger von #52');
  assert.equal(m.teamB, 'Kenya');
  assert.equal(m.setsA, 0);
  assert.equal(m.setsB, 0);
  assert.equal(m.pointsA, 0);
  assert.equal(m.pointsB, 0);
  assert.deepEqual(m.sets, []);
  assert.equal(m.status, 'Not Started');
  assert.equal(m.day, '');
  assert.equal(m.time, '');
});

test('mapMatch falls back to a shortened id when sheet_match_nr is missing', () => {
  const row = {
    id: 'aabbccdd-1234-5678-9999-000000000000', sheet_match_nr: null, round_label: 'Group Match 1',
    best_of: 3, status: 'scheduled', scheduled_time: null,
    team_a_id: 'team-a', team_b_id: 'team-b',
    team_a_source_outcome: null, team_b_source_outcome: null,
    team_a: { name: 'Switzerland' }, team_b: { name: 'Austria' },
    team_a_source_match: null, team_b_source_match: null,
    court: null, categories: { name: 'Test Category' }, sets: [],
  };
  const m = mapMatch(row);
  assert.equal(m.nr, 'aabbccdd');
});

test('mapCautions aggregates multiple events for the same player and keeps players separate', () => {
  const rows = [
    {
      event_type: 'Y', player_id: 'p1',
      player: { family_name: 'Muster', given_name: 'Max', jersey_number: 7, team: { name: 'Switzerland', category: { name: 'U18 M Gold' } } },
      match: { round_label: 'Qualification round' },
    },
    {
      event_type: 'YR', player_id: 'p1',
      player: { family_name: 'Muster', given_name: 'Max', jersey_number: 7, team: { name: 'Switzerland', category: { name: 'U18 M Gold' } } },
      match: { round_label: 'Semi-final 1' },
    },
    {
      event_type: 'R', player_id: 'p2',
      player: { family_name: 'Anders', given_name: 'Anna', jersey_number: 3, team: { name: 'Austria', category: { name: 'U18 W Gold' } } },
      match: { round_label: null },
    },
  ];
  const result = mapCautions(rows);
  assert.equal(result.length, 2);
  const p1 = result.find((p) => p.name === 'Muster');
  assert.equal(p1.teamName, 'Switzerland');
  assert.equal(p1.category, 'U18 M Gold');
  assert.equal(p1.nr, 7);
  assert.equal(p1.first, 'Max');
  assert.equal(p1.y, 1);
  assert.equal(p1.yr, 1);
  assert.equal(p1.r, 0);
  assert.equal(p1.events.length, 2);
  const p2 = result.find((p) => p.name === 'Anders');
  assert.equal(p2.r, 1);
  assert.equal(p2.events[0].game, '');
});

test('rulesFromConfig returns full defaults for null or empty config', () => {
  assert.deepEqual(rulesFromConfig(null), DEFAULT_RULES);
  assert.deepEqual(rulesFromConfig({}), DEFAULT_RULES);
});

test('rulesFromConfig applies config fields individually, falling back per-field', () => {
  const result = rulesFromConfig({ drawPoints: 2 });
  assert.equal(result.drawPoints, 2);
  assert.deepEqual(result.pointTable, DEFAULT_RULES.pointTable);
  assert.deepEqual(result.tiebreakers, DEFAULT_TIEBREAKERS);
});

test('rulesFromConfig normalizes tiebreaker aliases the same way the old Config-tab parser did', () => {
  const result = rulesFromConfig({ tiebreakers: ['SET_DIFFERENCE', 'H2H_POINT_QUOTIENT', 'not_a_real_key'] });
  assert.deepEqual(result.tiebreakers, ['SET_DIFF', 'H2H_POINT_RATIO']);
});

test('rulesFromConfig keeps a provided point table as-is', () => {
  const pointTable = [{ bestOf: 5, winSets: 3, loseSets: 0, winPts: 3, losePts: 0 }];
  const result = rulesFromConfig({ pointTable });
  assert.deepEqual(result.pointTable, pointTable);
});
