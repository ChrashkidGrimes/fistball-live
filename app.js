/* ============================================================
   Fistball Live — 2026 U18 WC & Women's EFA Championship
   Reads results live from Supabase and computes standings
   client-side.
   ============================================================ */

import { fetchTournament, fetchMatches, fetchCautions } from './supabase-client.js';
import {
  DEFAULT_RULES, mapMatch, mapCautions, rulesFromConfig,
} from './data-mapping.js';
import { state, CONFIG, persist, restoreJson } from './js/state.js';
import { genderOf, orderIndex } from './js/meta.js';
import { renderStandings } from './js/views/standings-view.js';
import { renderBracket } from './js/views/bracket-view.js';
import { renderMatches } from './js/views/matches-view.js';
import { renderCards } from './js/views/cards-view.js';
import { renderLive } from './js/views/live-view.js';
import { initPwa } from './js/pwa.js';

const $ = (id) => document.getElementById(id);

const TABS = [
  ['tabLive', 'live', 'liveView'],
  ['tabStandings', 'standings', 'standingsView'],
  ['tabBracket', 'bracket', 'bracketView'],
  ['tabMatches', 'matches', 'matchesView'],
  ['tabCards', 'cards', 'cardsView'],
];

/* ---------------------- Rendering ---------------------- */

function renderCategories() {
  const wrap = $("categoryPills");
  wrap.innerHTML = "";
  const groups = ["women", "men", "other"]
    .map((g) => [g, state.categories.filter((c) => genderOf(c) === g)]);
  for (const [g, cats] of groups) {
    if (!cats.length) continue;
    const row = document.createElement("div");
    row.className = "cat-row";
    const pills = document.createElement("div");
    pills.className = "cat-row-pills";
    for (const cat of cats) {
      const b = document.createElement("button");
      b.className = `pill pill--${g}` + (cat === state.activeCategory ? " is-active" : "");
      b.setAttribute("aria-pressed", String(cat === state.activeCategory));
      b.textContent = cat;
      b.onclick = () => { setCategory(cat); };
      pills.appendChild(b);
    }
    row.appendChild(pills);
    wrap.appendChild(row);
  }
  wrap.querySelector('.pill.is-active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

/* ---------------------- View switching ---------------------- */

function setCategory(cat) {
  state.activeCategory = cat;
  persist("fb_category", cat);
  renderCategories();
  renderActiveView();
}

function setView(view) {
  state.activeView = view;
  persist("fb_view", view);
  for (const [tabId, name, viewId] of TABS) {
    const active = view === name;
    const tab = $(tabId);
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    $(viewId).hidden = !active;
  }
  document.querySelector(".category-bar").hidden = view === "live";
  renderActiveView();
}

function renderActiveView() {
  if (state.activeView === "live") return renderLive();     // cross-category
  if (state.activeView === "cards") return renderCards();   // tournament-wide
  if (!state.activeCategory) return;
  if (state.activeView === "standings") renderStandings();
  else if (state.activeView === "bracket") renderBracket();
  else renderMatches();
}

/* ---------------------- Data loading ---------------------- */

async function load(showSpin) {
  const btn = $("refreshBtn");
  if (showSpin) btn.classList.add("spin");
  try {
    const tournament = await fetchTournament();
    const rawMatches = await fetchMatches(tournament.id);
    const matches = rawMatches.map(mapMatch);
    const matchIds = rawMatches.map((m) => m.id);

    state.rules = rulesFromConfig(tournament.config);
    persist("fb_rules", state.rules);

    // Cautions are optional — a failure here must not block the main
    // standings/matches display.
    const [cauR] = await Promise.allSettled([fetchCautions(matchIds)]);
    if (cauR.status === "fulfilled") {
      state.cautions = mapCautions(cauR.value);
      persist("fb_cautions", state.cautions);
    } else if (!state.cautions.length) {
      state.cautions = restoreJson('fb_cautions', []);
    }

    applyData(matches);
    cacheData(matches);
    $("banner").hidden = true;
  } catch (err) {
    console.warn("Live fetch failed:", err);
    if (!state.rules) {
      state.rules = restoreJson('fb_rules', DEFAULT_RULES);
    }
    const cached = restoreJson('fb_cache', null);
    if (cached && !state.matches.length) applyData(cached);
    showBanner("Couldn't reach the live data — showing the last data loaded. Pull to refresh when back online.");
  } finally {
    btn.classList.remove("spin");
  }
}

function applyData(matches) {
  if (!matches.length) return;
  state.matches = matches;

  // Distinct categories in fetch order (already sorted by scheduled_time).
  const seen = new Set();
  const cats = [];
  for (const m of matches) if (!seen.has(m.category)) { seen.add(m.category); cats.push(m.category); }
  // Order by the defined category order, unknowns last (alphabetical).
  cats.sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
  state.categories = cats;

  if (!state.activeCategory || !cats.includes(state.activeCategory)) {
    state.activeCategory = cats[0];
    persist("fb_category", state.activeCategory);
  }

  state.lastUpdated = new Date();
  $("updated").textContent = "Updated " + state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("loading").hidden = true;

  renderCategories();
  renderActiveView();
}

function cacheData(matches) {
  persist("fb_cache", matches);
}

function showBanner(msg) {
  const b = $("banner");
  b.textContent = msg;
  b.hidden = false;
}

/* ---------------------- Boot ---------------------- */

function updateHeaderHeight() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
}

initPwa();

updateHeaderHeight();
window.addEventListener('resize', updateHeaderHeight, { passive: true });

$("tabLive").onclick = () => setView("live");
$("tabStandings").onclick = () => setView("standings");
$("tabBracket").onclick = () => setView("bracket");
$("tabMatches").onclick = () => setView("matches");
$("tabCards").onclick = () => setView("cards");
$("refreshBtn").onclick = () => load(true);
setView(state.activeView);

// initial cache paint for instant load, then network
const boot = restoreJson('fb_cache', null);
if (boot) applyData(boot);
load(true);
setInterval(() => { if (!document.hidden) load(false); }, CONFIG.refreshMs);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
