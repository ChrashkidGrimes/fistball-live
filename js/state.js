/* Central mutable state + localStorage persistence for the viewer. */
import { DEFAULT_RULES } from '../data-mapping.js';

export const CONFIG = {
  refreshMs: 60000,         // auto-refresh interval
};

export function persist(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) {}
}

export function restore(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

export function restoreJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export const state = {
  matches: [],
  categories: [],
  activeCategory: restore('fb_category') || null,
  activeView: restore('fb_view') || 'live',
  matchFilter: 'all',
  crossMode: restore('fb_cross') || 'sets',
  rules: null,
  cautions: [],
  referees: new Map(),   // matchId -> [{match_id, role, referee: {name}}]
  lastUpdated: null,
};

export const rules = () => state.rules || DEFAULT_RULES;
