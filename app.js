/* ============================================================
   Fistball Live — 2026 U18 WC & Women's EFA Championship
   Reads results live from Supabase and computes standings
   client-side.
   ============================================================ */

import { fetchTournament, fetchMatches, fetchCautions } from './supabase-client.js';
import {
  DEFAULT_RULES, mapMatch, mapCautions, rulesFromConfig,
} from './data-mapping.js';
import { state, CONFIG, persist, restore } from './js/state.js';
import { genderOf, orderIndex } from './js/meta.js';
import { renderStandings } from './js/views/standings-view.js';
import { renderBracket } from './js/views/bracket-view.js';
import { renderMatches } from './js/views/matches-view.js';
import { renderCards } from './js/views/cards-view.js';
import { initPwa } from './js/pwa.js';

const $ = (id) => document.getElementById(id);

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
      b.textContent = cat;
      b.onclick = () => { setCategory(cat); };
      pills.appendChild(b);
    }
    row.appendChild(pills);
    wrap.appendChild(row);
  }
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
  $("tabStandings").classList.toggle("is-active", view === "standings");
  $("tabBracket").classList.toggle("is-active", view === "bracket");
  $("tabMatches").classList.toggle("is-active", view === "matches");
  $("tabCards").classList.toggle("is-active", view === "cards");
  $("standingsView").hidden = view !== "standings";
  $("bracketView").hidden = view !== "bracket";
  $("matchesView").hidden = view !== "matches";
  $("cardsView").hidden = view !== "cards";
  renderActiveView();
}

function renderActiveView() {
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
      const cachedCau = restore("fb_cautions");
      if (cachedCau) state.cautions = JSON.parse(cachedCau);
    }

    applyData(matches);
    cacheData(matches);
    $("banner").hidden = true;
  } catch (err) {
    console.warn("Live fetch failed:", err);
    if (!state.rules) {
      const cachedRules = restore("fb_rules");
      state.rules = cachedRules ? JSON.parse(cachedRules) : DEFAULT_RULES;
    }
    const cached = restore("fb_cache");
    if (cached && !state.matches.length) applyData(JSON.parse(cached));
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

initPwa();

$("tabStandings").onclick = () => setView("standings");
$("tabBracket").onclick = () => setView("bracket");
$("tabMatches").onclick = () => setView("matches");
$("tabCards").onclick = () => setView("cards");
$("refreshBtn").onclick = () => load(true);
setView(state.activeView);

// initial cache paint for instant load, then network
const boot = restore("fb_cache");
if (boot) try { applyData(JSON.parse(boot)); } catch (_) {}
load(true);
setInterval(() => { if (!document.hidden) load(false); }, CONFIG.refreshMs);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
