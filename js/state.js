/* Central mutable state + localStorage persistence for the viewer. */
import { DEFAULT_RULES } from '../data-mapping.js';

export const CONFIG = {
  refreshMs: 60000,         // auto-refresh interval
};

export function persist(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) {}
}

export function restore(key) {
  return localStorage.getItem(key);
}

export const state = {
  matches: [],
  categories: [],
  activeCategory: restore('fb_category') || null,
  activeView: restore('fb_view') || 'standings',
  matchFilter: 'all',
  crossMode: restore('fb_cross') || 'sets',
  rules: null,
  cautions: [],
  lastUpdated: null,
};

export const rules = () => state.rules || DEFAULT_RULES;
