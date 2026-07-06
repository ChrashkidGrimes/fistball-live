import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stub for node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { persist, restoreJson } = await import('./state.js');

beforeEach(() => store.clear());

test('restoreJson round-trips a persisted object', () => {
  persist('k', { a: 1 });
  assert.deepEqual(restoreJson('k', null), { a: 1 });
});

test('restoreJson returns the fallback for a missing key', () => {
  assert.equal(restoreJson('missing', 'fb'), 'fb');
});

test('restoreJson returns the fallback for corrupt JSON instead of throwing', () => {
  store.set('bad', '{not json');
  assert.deepEqual(restoreJson('bad', []), []);
});
