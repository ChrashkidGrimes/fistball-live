import { state } from '../state.js';
import { esc, flagFor, genderOf } from '../meta.js';

const $ = (id) => document.getElementById(id);

function cautionBadge(kind, n) {
  if (!n) return "";
  const label = { y: "Y", yr: "YR", r: "R" }[kind];
  return `<span class="badge ${kind}">${label}${n > 1 ? " ×" + n : ""}</span>`;
}

export function renderCards() {
  const host = $("cards");
  const players = state.cautions || [];
  if (!players.length) {
    host.innerHTML = `<div class="empty">No cautions recorded yet — cards will appear here as referees log them.</div>`;
    return;
  }
  // Group only by gender (Women / Men), then by team within each.
  const GENDER_LABEL = { women: "Women", men: "Men", other: "Other" };
  const byGender = new Map();
  for (const p of players) {
    const g = genderOf(p.category);
    if (!byGender.has(g)) byGender.set(g, new Map());
    const teams = byGender.get(g);
    if (!teams.has(p.team)) teams.set(p.team, []);
    teams.get(p.team).push(p);
  }

  let html = "";
  for (const g of ["women", "men", "other"]) {
    if (!byGender.has(g)) continue;
    html += `<p class="section-title">${GENDER_LABEL[g]}</p>`;
    const teams = [...byGender.get(g).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, ps] of teams) {
      const name = ps[0].teamName;
      ps.sort((a, b) => (b.r - a.r) || (b.yr - a.yr) || (b.y - a.y) || a.name.localeCompare(b.name));
      html += `<div class="card-team"><div class="card-team-head"><span class="flag">${flagFor(name)}</span>${esc(name)}</div>`;
      for (const p of ps) {
        const games = p.events.length
          ? `<div class="cp-games dim">${p.events.map((e) => `${e.type}${e.game ? " · game " + esc(e.game) : ""}`).join(" &nbsp;·&nbsp; ")}</div>`
          : "";
        html += `<div class="card-player">
          <span class="cp-name">${esc(((p.first ? p.first + " " : "") + p.name).trim() || "—")} ${p.nr ? `<span class="dim">#${esc(p.nr)}</span>` : ""}${games}</span>
          <span class="cp-badges">${cautionBadge("y", p.y)}${cautionBadge("yr", p.yr)}${cautionBadge("r", p.r)}</span>
        </div>`;
      }
      html += `</div>`;
    }
  }
  host.innerHTML = html;
}
