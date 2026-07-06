import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLive, selectUpNext, groupByCourt, changedMatchIds } from './live-select.js';

const m = (id, status, court, extra = {}) => ({
  id, status, court, category: 'C', teamA: 'A', teamB: 'B',
  setsA: 0, setsB: 0, pointsA: 0, pointsB: 0, ...extra,
});

test('selectLive keeps only live matches in input order', () => {
  const list = [m(1, 'Finished'), m(2, 'In progress'), m(3, 'Starting'), m(4, 'Not Started')];
  assert.deepEqual(selectLive(list).map((x) => x.id), [2, 3]);
});

test('selectUpNext takes the first n scheduled matches', () => {
  const list = [m(1, 'Not Started'), m(2, 'Finished'), m(3, 'Not Started'), m(4, 'Not Started')];
  assert.deepEqual(selectUpNext(list, 2).map((x) => x.id), [1, 3]);
});

test('groupByCourt sorts courts numerically and caps upNext at 2', () => {
  const list = [
    m(1, 'In progress', '10'), m(2, 'In progress', '2'),
    m(3, 'Not Started', '2'), m(4, 'Not Started', '2'), m(5, 'Not Started', '2'),
  ];
  const groups = groupByCourt(list);
  assert.deepEqual(groups.map((g) => g.court), ['2', '10']);
  assert.deepEqual(groups[0].live.map((x) => x.id), [2]);
  assert.deepEqual(groups[0].upNext.map((x) => x.id), [3, 4]);
});

test('groupByCourt appends a null-court group only when needed', () => {
  assert.deepEqual(groupByCourt([m(1, 'In progress', '1')]).map((g) => g.court), ['1']);
  const withNull = groupByCourt([m(1, 'In progress', '1'), m(2, 'Not Started', '')]);
  assert.deepEqual(withNull.map((g) => g.court), ['1', null]);
});

test('groupByCourt ignores finished matches entirely', () => {
  assert.deepEqual(groupByCourt([m(1, 'Finished', '1')]), []);
});

test('changedMatchIds flags score/status changes, ignores add/remove', () => {
  const before = [m(1, 'In progress', '1', { setsA: 1 }), m(2, 'Not Started', '1'), m(3, 'Finished', '1')];
  const after = [m(1, 'In progress', '1', { setsA: 2 }), m(2, 'In progress', '1'), m(4, 'Not Started', '1')];
  const ids = changedMatchIds(before, after);
  assert.deepEqual([...ids].sort(), [1, 2]);
});
