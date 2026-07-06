import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchPointsFor, breakTies, computeStandings, knockoutStage, groupTeams,
} from './standings.js';

const RULES = {
  drawPoints: 1,
  pointTable: [
    { bestOf: 5, winSets: 3, loseSets: 0, winPts: 3, losePts: 0 },
    { bestOf: 5, winSets: 3, loseSets: 1, winPts: 3, losePts: 0 },
    { bestOf: 5, winSets: 3, loseSets: 2, winPts: 2, losePts: 1 },
  ],
  tiebreakers: ['H2H_SET_DIFF', 'SET_DIFF', 'POINT_DIFF'],
};
const OPTS = { groupRounds: ['Qualification round'], isRealTeam: (n) => !!n && n !== 'TBD' };

const fin = (teamA, teamB, setsA, setsB, pointsA, pointsB) => ({
  category: 'C', round: 'Qualification round', status: 'Finished',
  teamA, teamB, setsA, setsB, pointsA, pointsB, bestOf: 5, sets: [],
});

test('matchPointsFor reads the point table for win and loss sides', () => {
  const m = { bestOf: 5 };
  assert.equal(matchPointsFor(m, 3, 2, RULES), 2);
  assert.equal(matchPointsFor(m, 2, 3, RULES), 1);
  assert.equal(matchPointsFor(m, 3, 0, RULES), 3);
  assert.equal(matchPointsFor(m, 0, 3, RULES), 0);
});

test('matchPointsFor falls back to 2/0 when the table has no row', () => {
  const m = { bestOf: 3 };
  assert.equal(matchPointsFor(m, 2, 1, RULES), 2);
  assert.equal(matchPointsFor(m, 1, 2, RULES), 0);
});

test('matchPointsFor returns drawPoints on equal sets', () => {
  assert.equal(matchPointsFor({ bestOf: 5 }, 1, 1, RULES), 1);
});

test('computeStandings ranks by points, counts W/L and set/point stats', () => {
  const games = [
    fin('A', 'B', 3, 0, 33, 20),
    fin('B', 'C', 3, 2, 45, 40),
    fin('C', 'A', 0, 3, 15, 33),
  ];
  const rows = computeStandings(games, 'C', RULES, OPTS);
  assert.deepEqual(rows.map((r) => r.team), ['A', 'B', 'C']);
  const a = rows[0];
  assert.equal(a.played, 2);
  assert.equal(a.wins, 2);
  assert.equal(a.pts, 6);
  assert.equal(a.setsWon, 6);
  assert.equal(a.setsLost, 0);
});

test('computeStandings returns null for a category without group games', () => {
  assert.equal(computeStandings([], 'C', RULES, OPTS), null);
});

test('computeStandings lists teams from unplayed fixtures with zero rows', () => {
  const games = [{ ...fin('A', 'B', 0, 0, 0, 0), status: 'Not Started' }];
  const rows = computeStandings(games, 'C', RULES, OPTS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].played, 0);
});

test('breakTies resolves a 3-way tie head-to-head and restarts the chain per subgroup', () => {
  // A beats B, B beats C, C beats A — full H2H circle, all equal on
  // H2H_SET_DIFF (each 3:3 in the circle) → falls through to SET_DIFF
  // where D-games differ.
  const games = [
    fin('A', 'B', 3, 0, 33, 11),
    fin('B', 'C', 3, 0, 33, 11),
    fin('C', 'A', 3, 0, 33, 11),
    fin('A', 'D', 3, 2, 40, 38),
    fin('B', 'D', 3, 1, 38, 30),
    fin('C', 'D', 3, 0, 33, 15),
  ];
  const order = breakTies(['A', 'B', 'C'], ['H2H_SET_DIFF', 'SET_DIFF'], games);
  // overall set diffs: A: 6-5=+1? -> A: won 3+3=6? A: vs B +3, vs C -3, vs D +1 => +1
  // B: vs A -3, vs C +3, vs D +2 => +2 ; C: vs B -3, vs A +3, vs D +3 => +3
  assert.deepEqual(order, ['C', 'B', 'A']);
});

test('breakTies falls back to alphabetical when fully tied', () => {
  const order = breakTies(['B', 'A'], ['SET_DIFF'], []);
  assert.deepEqual(order, ['A', 'B']);
});

test('knockoutStage classifies known round labels', () => {
  assert.deepEqual(knockoutStage('Semi-final 1').group, 'tree');
  assert.equal(knockoutStage('Semi-final 1').key, 'sf');
  assert.equal(knockoutStage('Gold Medal Match').key, 'final');
  assert.equal(knockoutStage('Bronze Medal Match').key, 'bronze');
  assert.equal(knockoutStage('4tr Final 2').key, 'qf');
  assert.equal(knockoutStage('Hoffnungsrunde').group, 'list');
  assert.equal(knockoutStage('Placement 5-6').title, '5th place');
  assert.equal(knockoutStage('Something else').title, 'Something else');
});

test('groupTeams collects and sorts group-stage teams, ignoring placeholders', () => {
  const games = [fin('B', 'A', 0, 0, 0, 0), { ...fin('TBD', 'A', 0, 0, 0, 0) }];
  assert.deepEqual(groupTeams(games, 'C', OPTS), ['A', 'B']);
});
