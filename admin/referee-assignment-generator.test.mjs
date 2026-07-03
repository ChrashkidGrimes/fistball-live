import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignReferees } from './referee-assignment-generator.js';

function match(id, time, teamA, teamB) {
  return { id, scheduled_time: time, team_a_name: teamA, team_b_name: teamB };
}
function referee(id, country, from = null, to = null) {
  return { id, country, available_from: from, available_to: to };
}

test('distributes assignments evenly across referees when nothing else constrains them', () => {
  const matches = [
    match('m1', '2026-07-23T09:00:00Z', 'A', 'B'),
    match('m2', '2026-07-23T10:00:00Z', 'A', 'B'),
    match('m3', '2026-07-23T11:00:00Z', 'A', 'B'),
    match('m4', '2026-07-23T12:00:00Z', 'A', 'B'),
  ];
  const referees = [referee('r1', 'Switzerland'), referee('r2', 'Austria')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['Recording Clerk'] });
  const counts = { r1: 0, r2: 0 };
  for (const r of result) counts[r.refereeId]++;
  assert.equal(counts.r1, 2);
  assert.equal(counts.r2, 2);
});

test('avoids assigning a referee to a 1st Referee slot for their own country when an alternative exists', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'Switzerland', 'Austria')];
  const referees = [referee('r1', 'Switzerland'), referee('r2', 'Germany')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['1st Referee'] });
  assert.equal(result[0].refereeId, 'r2');
});

test('still assigns the own-country referee to 1st Referee when no alternative exists (soft rule)', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'Switzerland', 'Austria')];
  const referees = [referee('r1', 'Switzerland')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['1st Referee'] });
  assert.equal(result[0].refereeId, 'r1');
});

test('respects available_from/available_to and picks an available referee instead', () => {
  const matches = [match('m1', '2026-07-24T09:00:00Z', 'A', 'B')];
  const referees = [
    referee('r1', 'Switzerland', '2026-07-23', '2026-07-23'),
    referee('r2', 'Austria', '2026-07-24', '2026-07-26'),
  ];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['Recording Clerk'] });
  assert.equal(result[0].refereeId, 'r2');
});

test('never double-books a referee at the same scheduled_time even within one run', () => {
  const matches = [
    match('m1', '2026-07-23T09:00:00Z', 'A', 'B'),
    match('m2', '2026-07-23T09:00:00Z', 'C', 'D'),
  ];
  const referees = [referee('r1', 'Switzerland')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['Recording Clerk'] });
  const filled = result.filter((r) => r.refereeId !== null);
  assert.equal(filled.length, 1);
  const empty = result.find((r) => r.refereeId === null);
  assert.ok(empty);
});

test('never assigns the same referee to two roles in the same match', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'A', 'B')];
  const referees = [referee('r1', 'Switzerland')];
  const result = assignReferees({ matches, referees, existingAssignments: [], roles: ['1st Referee', '2nd Referee'] });
  assert.equal(result[0].refereeId, 'r1');
  assert.equal(result[1].refereeId, null);
});

test('returns a null refereeId for a slot with zero referees available', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'A', 'B')];
  const result = assignReferees({ matches, referees: [], existingAssignments: [], roles: ['Recording Clerk'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].refereeId, null);
});

test('prefers a referee who was not assigned the immediately preceding time slot (rest rule)', () => {
  const matches = [
    match('m0', '2026-07-23T08:00:00Z', 'X', 'Y'),
    match('m1', '2026-07-23T09:00:00Z', 'A', 'B'),
    match('m2', '2026-07-23T10:00:00Z', 'C', 'D'),
  ];
  const referees = [referee('r1', 'Switzerland'), referee('r2', 'Austria')];
  // Both referees already have exactly 1 assignment each (tied count), so the
  // count tie-breaker alone would not distinguish them — isolates the rest
  // rule as the deciding factor. r1's existing assignment is at m1, the slot
  // immediately before m2; r2's is at m0, two slots before m2.
  const existingAssignments = [
    { referee_id: 'r1', match_id: 'm1', role: 'Recording Clerk' },
    { referee_id: 'r2', match_id: 'm0', role: 'Recording Clerk' },
  ];
  const result = assignReferees({ matches, referees, existingAssignments, roles: ['Recording Clerk'] });
  // m0 and m1 already have 'Recording Clerk' filled via existingAssignments,
  // so only m2 produces a result row.
  assert.equal(result.length, 1);
  assert.equal(result[0].matchId, 'm2');
  assert.equal(result[0].refereeId, 'r2');
});

test('respects an existing assignment in a match not included in the matches param (deselected category)', () => {
  const matches = [match('m1', '2026-07-23T09:00:00Z', 'A', 'B')];
  const referees = [referee('r1', 'Switzerland')];
  const existingAssignments = [
    { referee_id: 'r1', match_id: 'm_other_category', role: 'Recording Clerk', scheduled_time: '2026-07-23T09:00:00Z' },
  ];
  const result = assignReferees({ matches, referees, existingAssignments, roles: ['Recording Clerk'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].refereeId, null);
});
