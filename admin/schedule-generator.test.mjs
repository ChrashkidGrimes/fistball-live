import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRoundRobinRounds, assignScheduleSlots } from './schedule-generator.js';

test('computeRoundRobinRounds pairs every team against every other exactly once (even count)', () => {
  const rounds = computeRoundRobinRounds(['A', 'B', 'C', 'D']);
  assert.equal(rounds.length, 3);
  const allPairs = rounds.flat().map((p) => p.slice().sort().join('-'));
  const expected = ['A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D'];
  assert.deepEqual(allPairs.slice().sort(), expected);
});

test('computeRoundRobinRounds handles an odd team count with a bye', () => {
  const rounds = computeRoundRobinRounds(['A', 'B', 'C', 'D', 'E']);
  assert.equal(rounds.length, 5);
  const allPairs = rounds.flat().map((p) => p.slice().sort().join('-'));
  assert.equal(allPairs.length, 10);
  assert.equal(new Set(allPairs).size, 10);
});

test('assignScheduleSlots places every pairing on a distinct court/time with no collisions', () => {
  const rounds = [[['A', 'B'], ['C', 'D']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1', 'court2'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T18:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignments.length, 2);
  const slots = result.assignments.map((a) => `${a.courtId}|${a.scheduledTime}`);
  assert.equal(new Set(slots).size, 2);
});

test('assignScheduleSlots skips a court/time already booked by an existing match', () => {
  const rounds = [[['A', 'B']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T18:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [
      { team_a_id: 'X', team_b_id: 'Y', court_id: 'court1', scheduled_time: '2026-07-23T09:00:00Z' },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignments[0].scheduledTime, '2026-07-23T09:45:00.000Z');
});

test('assignScheduleSlots never double-books a team at the same time even across rounds', () => {
  const rounds = [[['A', 'B']], [['A', 'C']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1', 'court2'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T18:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [],
  });
  assert.equal(result.ok, true);
  const aTimes = result.assignments.filter((a) => a.teamA === 'A' || a.teamB === 'A').map((a) => a.scheduledTime);
  assert.equal(new Set(aTimes).size, 2);
});

test('assignScheduleSlots reports missing slots when the time range is too short', () => {
  const rounds = [[['A', 'B'], ['C', 'D'], ['E', 'F']]];
  const result = assignScheduleSlots({
    rounds,
    courtIds: ['court1'],
    startTime: '2026-07-23T09:00:00Z',
    endTime: '2026-07-23T09:00:00Z',
    matchDurationMinutes: 40,
    breakMinutes: 5,
    existingMatches: [
      { team_a_id: 'X', team_b_id: 'Y', court_id: 'court1', scheduled_time: '2026-07-23T09:00:00Z' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.missingSlots, 3);
});
