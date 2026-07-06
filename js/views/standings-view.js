import { state, rules, persist } from '../state.js';
import { GROUP_ROUNDS, esc, flagFor, codeFor, isFinished } from '../meta.js';
import { computeStandings, groupTeams, headToHead, knockoutMatches } from '../standings.js';
import { isRealTeam } from '../../data-mapping.js';

const $ = (id) => document.getElementById(id);

export function renderStandings() {
  const host = $("standings");
  const rows = computeStandings(state.matches, state.activeCategory, rules(), { groupRounds: GROUP_ROUNDS, isRealTeam });
  let html = "";

  if (rows) {
    const anyPlayed = rows.some((r) => r.played > 0);
    const showDraws = rows.some((r) => r.draws > 0);
    const qualifyCount = Math.min(2, rows.length); // highlight top 2

    html += `<p class="section-title">${esc(state.activeCategory)} · Group standings</p>`;
    html += `<div class="table-wrap"><table class="standings">
      <thead><tr>
        <th>#</th><th class="team">Team</th><th>M</th><th>W</th>${showDraws ? "<th>D</th>" : ""}<th>L</th>
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
        ${showDraws ? `<td>${r.draws}</td>` : ""}
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
    const ko = knockoutMatches(state.matches, state.activeCategory, GROUP_ROUNDS).length > 0;
    html = ko
      ? `<div class="empty">This category is a knock-out stage — no group table.<br>See the <b>Bracket</b> tab.</div>`
      : `<div class="empty">No data for this category yet — check the <b>Matches</b> tab.</div>`;
  }

  host.innerHTML = html;

  host.querySelectorAll(".cross-toggle .chip").forEach((b) => {
    b.onclick = () => {
      state.crossMode = b.dataset.mode;
      persist("fb_cross", b.dataset.mode);
      renderStandings();
    };
  });
}

// The cross / head-to-head grid (mirrors the spreadsheet's results matrix).
function renderCrossTable(category) {
  const teams = groupTeams(state.matches, category, { groupRounds: GROUP_ROUNDS, isRealTeam });
  if (teams.length < 2) return "";
  const mode = state.crossMode === "points" ? "points" : "sets";

  let html = `<div class="cross-bar">
      <p class="section-title">Head-to-head · ${mode === "points" ? "points" : "sets"}</p>
      <div class="cross-toggle">
        <button class="chip ${mode === "sets" ? "is-active" : ""}" data-mode="sets" aria-pressed="${mode === "sets"}">Sets</button>
        <button class="chip ${mode === "points" ? "is-active" : ""}" data-mode="points" aria-pressed="${mode === "points"}">Points</button>
      </div>
    </div>`;

  html += `<div class="cross-wrap"><table class="cross"><thead><tr><th class="corner"></th>`;
  for (const c of teams) {
    html += `<th title="${esc(c)}"><span class="flag">${flagFor(c)}</span><br>${esc(codeFor(c))}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const r of teams) {
    html += `<tr><th class="rowhead" title="${esc(r)}"><span class="flag">${flagFor(r)}</span>${esc(r)}</th>`;
    for (const c of teams) {
      if (r === c) { html += `<td class="self"></td>`; continue; }
      const m = headToHead(state.matches, category, r, c, GROUP_ROUNDS);
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
