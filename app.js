/* ============================================================
   Fistball Live — 2026 U18 WC & Women's EFA Championship
   Reads results live from the public Google Sheet (gviz CSV)
   and computes standings client-side.
   ============================================================ */

const CONFIG = {
  // The published/shared Google Sheet that holds the results.
  sheetId: "1IWuv2zOZtIJDZCFnItp_z8p546azRGlD8I052jVe8Mk",
  gid: "0",                 // tab that holds the schedule + scores
  refreshMs: 60000,         // auto-refresh interval
};

// gviz CSV endpoint — works for any sheet shared as "anyone with the link can view".
const DATA_URL = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=out:csv&gid=${CONFIG.gid}&_=`;

// Rounds that form a round-robin group stage (used to compute standings).
const GROUP_ROUNDS = ["Qualification round", "WEC - Vorrunde"];
const STATUS_VALUES = ["Not Started", "Starting", "In progress", "Finished"];

// Category chips are grouped into two rows (Women, then Men) and ordered
// within each row following this list (the order used in the sheet).
const CATEGORY_ORDER = [
  // Women
  "WEC", "U18 W Gold", "U18 W Silver", "U18 Women", "P 7-9 Women",
  // Men
  "U18 M Gold", "U18 M Silver", "U18 Men", "P 7-9 Men",
];
function genderOf(cat) {
  if (cat === "WEC" || /\b(w|women)\b/i.test(cat)) return "women";
  if (/\b(m|men)\b/i.test(cat)) return "men";
  return "other";
}
function orderIndex(cat) {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? 999 : i;
}

// Map of country -> flag emoji (best effort; falls back to none).
const FLAGS = {
  "Austria": "🇦🇹", "Brazil": "🇧🇷", "Germany": "🇩🇪", "Switzerland": "🇨🇭",
  "Chile": "🇨🇱", "India": "🇮🇳", "Namibia": "🇳🇦", "Kenya": "🇰🇪",
  "New Zealand": "🇳🇿", "Italy": "🇮🇹", "Czech Republic": "🇨🇿", "Denmark": "🇩🇰",
  "Serbia": "🇷🇸",
};

const state = {
  matches: [],
  categories: [],
  activeCategory: localStorage.getItem("fb_category") || null,
  activeView: localStorage.getItem("fb_view") || "standings",
  matchFilter: "all",
  crossMode: localStorage.getItem("fb_cross") || "sets",
  lastUpdated: null,
};

/* ---------------------- CSV parsing ---------------------- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------------------- Match model ---------------------- */

const num = (v) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

// Strip the trailing " - <Category>" suffix from a team name.
function cleanTeam(name, category) {
  if (!name) return name;
  let n = name.trim();
  if (category && n.endsWith(" - " + category)) {
    n = n.slice(0, -(" - " + category).length);
  } else {
    // fall back: drop suffix after last " - " if it looks like a category tag
    const m = n.match(/^(.*?) - (U18 .*|WEC)$/);
    if (m) n = m[1];
  }
  return n.trim();
}

// A team is a real entrant (not a bracket placeholder).
// Placeholders are the *cleaned* names like "Gold 3rd", "Winner SF1", "WEC R4",
// "5th Silver", "Loser L1" — all of which contain a digit or "winner"/"loser".
// Real country names never do.
function isRealTeam(name) {
  if (!name) return false;
  return !/\d/.test(name) && !/(winner|loser)/i.test(name);
}

function flagFor(team) {
  return FLAGS[team] || "";
}

// Build a match object from one CSV data row.
function rowToMatch(r) {
  const nr = num(r[2]);
  const teamA = (r[4] || "").trim();
  const teamB = (r[5] || "").trim();
  const category = (r[7] || "").trim();
  if (!nr || !teamA || !teamB || !category) return null;

  const setsA = num(r[9]);
  const setsB = num(r[11]);

  // Status: find a cell matching a known status value.
  let status = "Not Started";
  for (const cell of r) {
    const t = (cell || "").trim();
    if (STATUS_VALUES.includes(t)) { status = t; break; }
  }

  // Total points: located around the "|" separator token.
  let pointsA = 0, pointsB = 0;
  const pipeIdx = r.findIndex((c) => (c || "").trim() === "|");
  if (pipeIdx > 0) { pointsA = num(r[pipeIdx - 1]); pointsB = num(r[pipeIdx + 1]); }

  // Per-set scores: triplets (a, "x", b) sitting between Total Sets (col 11) and the "|".
  const sets = [];
  const setEnd = pipeIdx > 13 ? pipeIdx : r.length;
  for (let i = 12; i + 2 < setEnd; i += 3) {
    if ((r[i + 1] || "").trim() !== "x") break;
    const a = num(r[i]), b = num(r[i + 2]);
    if (a === 0 && b === 0) continue;
    sets.push([a, b]);
  }

  return {
    day: (r[0] || "").trim(),
    time: (r[1] || "").trim(),
    nr,
    court: (r[3] || "").trim(),
    teamARaw: teamA,
    teamBRaw: teamB,
    teamA: cleanTeam(teamA, category),
    teamB: cleanTeam(teamB, category),
    round: (r[6] || "").trim(),
    category,
    bestOf: num(r[8]),
    setsA, setsB,
    pointsA, pointsB,
    sets,
    status,
  };
}

function statusClass(s) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}
function isFinished(m) { return m.status === "Finished"; }
function isLive(m) { return m.status === "In progress" || m.status === "Starting"; }

/* ---------------------- Standings ---------------------- */

function computeStandings(category) {
  const games = state.matches.filter(
    (m) => m.category === category &&
      GROUP_ROUNDS.includes(m.round) &&
      isRealTeam(m.teamA) && isRealTeam(m.teamB)
  );
  if (!games.length) return null;

  const tbl = new Map();
  const ensure = (name) => {
    if (!tbl.has(name)) tbl.set(name, {
      team: name, played: 0, wins: 0, losses: 0,
      setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, pts: 0,
    });
    return tbl.get(name);
  };

  // Register all teams so even those who haven't played yet show up.
  for (const g of games) { ensure(g.teamA); ensure(g.teamB); }

  for (const g of games) {
    if (!isFinished(g)) continue;
    const a = ensure(g.teamA), b = ensure(g.teamB);
    a.played++; b.played++;
    a.setsWon += g.setsA; a.setsLost += g.setsB;
    b.setsWon += g.setsB; b.setsLost += g.setsA;
    a.pointsFor += g.pointsA; a.pointsAgainst += g.pointsB;
    b.pointsFor += g.pointsB; b.pointsAgainst += g.pointsA;
    if (g.setsA > g.setsB) { a.wins++; b.losses++; a.pts += 2; }
    else if (g.setsB > g.setsA) { b.wins++; a.losses++; b.pts += 2; }
  }

  const rows = [...tbl.values()];
  rows.sort((x, y) =>
    y.pts - x.pts ||
    (y.setsWon - y.setsLost) - (x.setsWon - x.setsLost) ||
    (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst) ||
    x.team.localeCompare(y.team)
  );
  return rows;
}

/* ---------------------- Rendering ---------------------- */

const $ = (id) => document.getElementById(id);

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

function renderStandings() {
  const host = $("standings");
  const rows = computeStandings(state.activeCategory);
  let html = "";

  if (rows) {
    const anyPlayed = rows.some((r) => r.played > 0);
    const qualifyCount = Math.min(2, rows.length); // highlight top 2

    html += `<p class="section-title">${esc(state.activeCategory)} · Group standings</p>`;
    html += `<div class="table-wrap"><table class="standings">
      <thead><tr>
        <th>#</th><th class="team">Team</th><th>P</th><th>W</th><th>L</th>
        <th>Sets</th><th>±</th><th>Pts</th>
      </tr></thead><tbody>`;
    rows.forEach((r, i) => {
      const setDiff = r.setsWon - r.setsLost;
      const qualified = i < qualifyCount;
      html += `<tr class="${qualified ? "qualified" : ""}">
        <td><span class="pos">${i + 1}</span></td>
        <td class="team"><span class="team-name"><span class="flag">${flagFor(r.team)}</span>${esc(r.team)}</span></td>
        <td>${r.played}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td class="dim">${r.setsWon}-${r.setsLost}</td>
        <td class="${setDiff > 0 ? "" : "dim"}">${setDiff > 0 ? "+" : ""}${setDiff}</td>
        <td class="pts-col">${r.pts}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
    if (!anyPlayed) {
      html += `<div class="empty">No matches completed yet — standings will fill in as results come in.</div>`;
    }
    html += renderCrossTable(state.activeCategory);
  }

  if (!html) {
    const ko = knockoutMatches(state.activeCategory).length > 0;
    html = ko
      ? `<div class="empty">This category is a knock-out stage — no group table.<br>See the <b>Bracket</b> tab.</div>`
      : `<div class="empty">No data for this category yet — check the <b>Matches</b> tab.</div>`;
  }

  host.innerHTML = html;

  host.querySelectorAll(".cross-toggle .chip").forEach((b) => {
    b.onclick = () => {
      state.crossMode = b.dataset.mode;
      localStorage.setItem("fb_cross", b.dataset.mode);
      renderStandings();
    };
  });
}

// Short codes for the cross-table column headers.
const CODES = {
  Austria: "AUT", Brazil: "BRA", Germany: "GER", Switzerland: "SUI", Chile: "CHI",
  India: "IND", Namibia: "NAM", Kenya: "KEN", "New Zealand": "NZL", Italy: "ITA",
  "Czech Republic": "CZE", Denmark: "DEN", Serbia: "SRB",
};
const codeFor = (t) => CODES[t] || t.slice(0, 3).toUpperCase();

function groupTeams(category) {
  const set = new Set();
  for (const m of state.matches) {
    if (m.category === category && GROUP_ROUNDS.includes(m.round) &&
        isRealTeam(m.teamA) && isRealTeam(m.teamB)) {
      set.add(m.teamA); set.add(m.teamB);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// The head-to-head match between two teams in a category's group stage.
function headToHead(category, t1, t2) {
  return state.matches.find((m) =>
    m.category === category && GROUP_ROUNDS.includes(m.round) &&
    ((m.teamA === t1 && m.teamB === t2) || (m.teamA === t2 && m.teamB === t1)));
}

// The cross / head-to-head grid (mirrors the spreadsheet's results matrix).
function renderCrossTable(category) {
  const teams = groupTeams(category);
  if (teams.length < 2) return "";
  const mode = state.crossMode === "points" ? "points" : "sets";

  let html = `<div class="cross-bar">
      <p class="section-title">Head-to-head · ${mode === "points" ? "points" : "sets"}</p>
      <div class="cross-toggle">
        <button class="chip ${mode === "sets" ? "is-active" : ""}" data-mode="sets">Sets</button>
        <button class="chip ${mode === "points" ? "is-active" : ""}" data-mode="points">Points</button>
      </div>
    </div>`;

  html += `<div class="cross-wrap"><table class="cross"><thead><tr><th class="corner"></th>`;
  for (const c of teams) {
    html += `<th title="${esc(c)}"><span class="flag">${flagFor(c)}</span><br>${codeFor(c)}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const r of teams) {
    html += `<tr><th class="rowhead" title="${esc(r)}"><span class="flag">${flagFor(r)}</span>${esc(r)}</th>`;
    for (const c of teams) {
      if (r === c) { html += `<td class="self"></td>`; continue; }
      const m = headToHead(category, r, c);
      let cls = "np", txt = "–", dot = "";
      if (m) {
        const rowIsA = m.teamA === r;
        const rs = rowIsA ? m.setsA : m.setsB;
        const os = rowIsA ? m.setsB : m.setsA;
        const rp = rowIsA ? m.pointsA : m.pointsB;
        const op = rowIsA ? m.pointsB : m.pointsA;
        if (isFinished(m) || rs + os > 0) {
          txt = mode === "points" ? `${rp}:${op}` : `${rs}:${os}`;
          if (!isFinished(m)) {
            // game still in progress — show as live, not a final win/loss
            cls = "live";
            dot = `<span class="cell-dot" title="Live"></span>`;
          } else {
            cls = rs > os ? "win" : os > rs ? "loss" : "np";
          }
        }
      }
      html += `<td class="${cls}">${txt}${dot}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

/* ---------------------- Knockout / bracket ---------------------- */

function knockoutMatches(category) {
  return state.matches.filter((m) =>
    m.category === category && !GROUP_ROUNDS.includes(m.round));
}

// Classify a knockout round into a tree stage (medal path) or a list stage.
function knockoutStage(round) {
  const r = round.toLowerCase();
  if (r.includes("4tr final") || r.includes("quarter")) return { group: "tree", key: "qf", title: "Quarterfinals" };
  if (r.includes("semi") || r.includes("halbfinale")) return { group: "tree", key: "sf", title: "Semifinals" };
  if (r.includes("bronze")) return { group: "tree", key: "bronze", title: "Bronze" };
  if (r.includes("gold medal") || r.includes("gold medal match")) return { group: "tree", key: "final", title: "Final" };
  if (r.includes("hoffnung")) return { group: "list", title: "Repechage", order: 1 };
  if (r.includes("intermediate")) return { group: "list", title: "Intermediate round", order: 2 };
  if (r.includes("placement 5")) return { group: "list", title: "5th place", order: 3 };
  if (r.includes("7-9") || r.includes("placement 7")) return { group: "list", title: "Places 7–9", order: 4 };
  return { group: "list", title: round, order: 5 };
}

// Compact bracket node (keeps the sheet's slot labels, e.g. "Winner SF1").
function bracketNode(m) {
  if (!m) return `<div class="bmatch empty">—</div>`;
  const played = isFinished(m) || m.setsA + m.setsB > 0;
  const aWin = isFinished(m) && m.setsA > m.setsB;
  const bWin = isFinished(m) && m.setsB > m.setsA;
  const live = isLive(m);
  const side = (name, sets, pts, win) =>
    `<div class="bteam ${win ? "win" : ""}">
       <span class="bn">${esc(name)}</span>
       <span class="bsc"><span class="bs">${played ? sets : ""}</span><span class="bp">${played ? pts : ""}</span></span>
     </div>`;
  return `<div class="bmatch ${live ? "live" : ""}">
      ${side(m.teamA, m.setsA, m.pointsA, aWin)}
      ${side(m.teamB, m.setsB, m.pointsB, bWin)}
    </div>`;
}

function renderKnockout(category) {
  const ms = knockoutMatches(category);
  if (!ms.length) return "";

  const tree = { qf: [], sf: [], bronze: [], final: [] };
  const lists = new Map();
  for (const m of ms) {
    const st = knockoutStage(m.round);
    if (st.group === "tree") tree[st.key].push(m);
    else {
      if (!lists.has(st.title)) lists.set(st.title, { order: st.order, items: [] });
      lists.get(st.title).items.push(m);
    }
  }

  let html = "";

  // Medal-path tree
  const cols = [];
  if (tree.qf.length) cols.push(["Quarterfinals", tree.qf]);
  if (tree.sf.length) cols.push(["Semifinals", tree.sf]);
  if (tree.final.length || tree.bronze.length) cols.push(["Final", tree.final, tree.bronze]);
  if (cols.length) {
    html += `<div class="bracket">`;
    for (const [title, items, bronze] of cols) {
      if (bronze !== undefined) {
        // Final column: final centred (level with the SF midpoint), bronze just below.
        // An invisible clone of the bronze block above the final keeps it symmetric
        // (so the final stays centred) while everything stays in normal flow — no overflow.
        const bronzeInner = bronze.length
          ? `<div class="bround-title bronze-title">Bronze</div>${bronze.map(bracketNode).join("")}`
          : "";
        html += `<div class="bround"><div class="bround-title">${title}</div>
          <div class="bround-cards bround-cards--final">
            ${bronzeInner ? `<div class="bronze-block bronze-spacer" aria-hidden="true">${bronzeInner}</div>` : ""}
            ${items.map(bracketNode).join("")}
            ${bronzeInner ? `<div class="bronze-block">${bronzeInner}</div>` : ""}
          </div></div>`;
      } else {
        html += `<div class="bround"><div class="bround-title">${title}</div>
          <div class="bround-cards">${items.map((m) => `<div class="bslot">${bracketNode(m)}</div>`).join("")}</div></div>`;
      }
    }
    html += `</div>`;
  }

  // Placement / other rounds as cards
  const ordered = [...lists.entries()].sort((a, b) => (a[1].order || 9) - (b[1].order || 9));
  for (const [title, obj] of ordered) {
    html += `<p class="section-title sub">${esc(title)}</p>`;
    html += obj.items.map(matchCard).join("");
  }
  return html;
}

function renderMatchFilter() {
  const host = $("matchFilter");
  const filters = [
    ["all", "All"], ["live", "Live"], ["finished", "Finished"], ["upcoming", "Upcoming"],
  ];
  host.innerHTML = filters.map(([k, label]) =>
    `<button class="chip ${state.matchFilter === k ? "is-active" : ""}" data-f="${k}">${label}</button>`
  ).join("");
  host.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => { state.matchFilter = c.dataset.f; renderMatches(); };
  });
}

function matchPassesFilter(m) {
  switch (state.matchFilter) {
    case "live": return isLive(m);
    case "finished": return isFinished(m);
    case "upcoming": return m.status === "Not Started";
    default: return true;
  }
}

function renderMatches() {
  renderMatchFilter();
  const host = $("matches");
  const list = state.matches
    .filter((m) => m.category === state.activeCategory && matchPassesFilter(m));
  if (!list.length) {
    host.innerHTML = `<div class="empty">No matches to show for this filter.</div>`;
    return;
  }

  // group by day, preserving sheet order
  const groups = [];
  const idx = new Map();
  for (const m of list) {
    const key = m.day || "—";
    if (!idx.has(key)) { idx.set(key, groups.length); groups.push({ day: key, items: [] }); }
    groups[idx.get(key)].items.push(m);
  }

  host.innerHTML = groups.map((g) => `
    <div class="day-group">
      <div class="day-head">${esc(g.day)}</div>
      ${g.items.map(matchCard).join("")}
    </div>`).join("");
}

function matchCard(m) {
  const aWin = isFinished(m) && m.setsA > m.setsB;
  const bWin = isFinished(m) && m.setsB > m.setsA;
  const live = isLive(m);
  const showSets = (m.setsA + m.setsB > 0) || m.sets.length > 0;

  const setBadges = m.sets.length
    ? `<div class="setline"><div class="set-scores">${m.sets.map(([a, b]) =>
        `<span class="s ${a > b ? "won" : ""}">${a}</span><span class="s dim">:</span><span class="s ${b > a ? "won" : ""}">${b}</span>`
      ).join('<span class="s dim">·</span>')}</div></div>`
    : "";

  return `
  <div class="match ${live ? "live" : ""}">
    <div class="match-top">
      <div class="match-meta">
        <span>${esc(m.time)}</span>
        ${m.court ? `<span class="tag">Court ${esc(m.court)}</span>` : ""}
        <span class="tag">#${m.nr}</span>
        <span class="tag">${esc(m.round)}</span>
      </div>
      <span class="status ${statusClass(m.status)}">${esc(m.status)}</span>
    </div>
    <div class="match-row ${aWin ? "winner" : ""}">
      <div class="side"><span class="flag">${flagFor(m.teamA)}</span><span class="name">${esc(m.teamA)}</span></div>
      ${showSets ? `<div class="big-sets ${aWin ? "win" : ""}">${m.setsA}</div>` : ""}
    </div>
    <div class="match-divider"></div>
    <div class="match-row ${bWin ? "winner" : ""}">
      <div class="side"><span class="flag">${flagFor(m.teamB)}</span><span class="name">${esc(m.teamB)}</span></div>
      ${showSets ? `<div class="big-sets ${bWin ? "win" : ""}">${m.setsB}</div>` : ""}
    </div>
    ${setBadges}
  </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---------------------- View switching ---------------------- */

function setCategory(cat) {
  state.activeCategory = cat;
  localStorage.setItem("fb_category", cat);
  renderCategories();
  renderActiveView();
}

function setView(view) {
  state.activeView = view;
  localStorage.setItem("fb_view", view);
  $("tabStandings").classList.toggle("is-active", view === "standings");
  $("tabBracket").classList.toggle("is-active", view === "bracket");
  $("tabMatches").classList.toggle("is-active", view === "matches");
  $("standingsView").hidden = view !== "standings";
  $("bracketView").hidden = view !== "bracket";
  $("matchesView").hidden = view !== "matches";
  renderActiveView();
}

function renderActiveView() {
  if (!state.activeCategory) return;
  if (state.activeView === "standings") renderStandings();
  else if (state.activeView === "bracket") renderBracket();
  else renderMatches();
}

function renderBracket() {
  const host = $("bracket");
  const html = renderKnockout(state.activeCategory);
  host.innerHTML = html ||
    `<div class="empty">No knockout stage for this category.<br>Check <b>Standings</b> or <b>Matches</b>.</div>`;
}

/* ---------------------- Data loading ---------------------- */

async function load(showSpin) {
  const btn = $("refreshBtn");
  if (showSpin) btn.classList.add("spin");
  try {
    const res = await fetch(DATA_URL + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    applyData(text);
    cacheData(text);
    $("banner").hidden = true;
  } catch (err) {
    console.warn("Live fetch failed:", err);
    const cached = localStorage.getItem("fb_cache");
    if (cached && !state.matches.length) applyData(cached);
    showBanner("Couldn't reach the live sheet — showing the last data loaded. Pull to refresh when back online.");
  } finally {
    btn.classList.remove("spin");
  }
}

function applyData(csvText) {
  const rows = parseCSV(csvText);
  const matches = rows.map(rowToMatch).filter(Boolean);
  if (!matches.length) return;
  state.matches = matches;

  // Distinct categories in sheet order.
  const seen = new Set();
  const cats = [];
  for (const m of matches) if (!seen.has(m.category)) { seen.add(m.category); cats.push(m.category); }
  // Order by the defined category order, unknowns last (alphabetical).
  cats.sort((a, b) => orderIndex(a) - orderIndex(b) || a.localeCompare(b));
  state.categories = cats;

  if (!state.activeCategory || !cats.includes(state.activeCategory)) {
    state.activeCategory = cats[0];
    localStorage.setItem("fb_category", state.activeCategory);
  }

  state.lastUpdated = new Date();
  $("updated").textContent = "Updated " + state.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("loading").hidden = true;

  renderCategories();
  renderActiveView();
}

function cacheData(text) {
  try { localStorage.setItem("fb_cache", text); } catch (_) {}
}

function showBanner(msg) {
  const b = $("banner");
  b.textContent = msg;
  b.hidden = false;
}

/* ---------------------- PWA install ---------------------- */

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("installBtn").hidden = false;
});
$("installBtn").onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("installBtn").hidden = true;
};

// --- Service worker + "new version available" prompt ---
function showUpdateToast(worker) {
  const toast = $("updateToast");
  const btn = $("updateBtn");
  if (!toast || !worker) return;
  toast.hidden = false;
  btn.onclick = () => {
    btn.textContent = "Updating…";
    btn.disabled = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  };
}

if ("serviceWorker" in navigator) {
  let reloading = false;
  // When the new worker takes control, reload once to pick up fresh assets.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");

      // A new version was already downloaded and is waiting.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);

      // A new version is being downloaded right now.
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          // installed + an existing controller means it's an update, not first install.
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast(reg.waiting || nw);
          }
        });
      });

      // Check the server for a newer version periodically and on refocus.
      const checkForUpdate = () => reg.update().catch(() => {});
      setInterval(checkForUpdate, 30 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });
    } catch (_) { /* ignore */ }
  });
}

/* ---------------------- Boot ---------------------- */

$("tabStandings").onclick = () => setView("standings");
$("tabBracket").onclick = () => setView("bracket");
$("tabMatches").onclick = () => setView("matches");
$("refreshBtn").onclick = () => load(true);
setView(state.activeView);

// initial cache paint for instant load, then network
const boot = localStorage.getItem("fb_cache");
if (boot) try { applyData(boot); } catch (_) {}
load(true);
setInterval(() => { if (!document.hidden) load(false); }, CONFIG.refreshMs);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
