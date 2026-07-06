import { state } from '../state.js';
import { GROUP_ROUNDS, esc, isFinished, isLive } from '../meta.js';
import { knockoutMatches, knockoutStage } from '../standings.js';
import { matchCard } from './matches-view.js';

const $ = (id) => document.getElementById(id);

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
  const ms = knockoutMatches(state.matches, category, GROUP_ROUNDS);
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
        const goldLabel = `<div class="bround-title gold-title">Gold</div>`;
        const bronzeInner = bronze.length
          ? `<div class="bround-title bronze-title">Bronze</div>${bronze.map(bracketNode).join("")}`
          : "";
        // Stack is symmetric about the final match so it stays centred:
        // [invisible bronze][Gold + final][Bronze + bronze][invisible Gold]
        html += `<div class="bround"><div class="bround-title">${title}</div>
          <div class="bround-cards bround-cards--final">
            ${bronzeInner ? `<div class="bronze-block bronze-spacer" aria-hidden="true">${bronzeInner}</div>` : ""}
            <div class="gold-block">${goldLabel}${items.map(bracketNode).join("")}</div>
            ${bronzeInner ? `<div class="bronze-block">${bronzeInner}</div>` : ""}
            ${bronzeInner ? `<div class="gold-spacer" aria-hidden="true">${goldLabel}</div>` : ""}
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

export function renderBracket() {
  const host = $("bracket");
  const html = renderKnockout(state.activeCategory);
  host.innerHTML = html ||
    `<div class="empty">No knockout stage for this category.<br>Check <b>Standings</b> or <b>Matches</b>.</div>`;
}
