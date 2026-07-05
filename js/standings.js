/* Pure tournament math — no DOM, no fetch, no global state.
   Everything takes matches/rules as parameters so it is unit-testable. */

const isFinished = (m) => m.status === "Finished";

/* ---------------------- Standings ---------------------- */

// Tournament points a team earns from one finished match, via the Point Table.
export function matchPointsFor(m, mySets, oppSets, rules) {
  if (mySets === oppSets) return rules.drawPoints;          // draw
  const win = mySets > oppSets;
  const winSets = Math.max(mySets, oppSets), loseSets = Math.min(mySets, oppSets);
  const row = rules.pointTable.find(
    (t) => t.bestOf === m.bestOf && t.winSets === winSets && t.loseSets === loseSets);
  if (row) return win ? row.winPts : row.losePts;
  return win ? 2 : 0;                                          // fallback if table has no row
}

// Per-team set/ball-point stats over the given matches. A team's stats count
// every match it appears in (the caller pre-filters to head-to-head matches
// when a criterion is head-to-head only).
export function aggregate(teams, matches) {
  const s = new Map(teams.map((t) => [t, { sw: 0, sl: 0, pf: 0, pa: 0, wins: 0 }]));
  for (const m of matches) {
    if (s.has(m.teamA)) {
      const a = s.get(m.teamA);
      a.sw += m.setsA; a.sl += m.setsB; a.pf += m.pointsA; a.pa += m.pointsB;
      if (m.setsA > m.setsB) a.wins++;
    }
    if (s.has(m.teamB)) {
      const b = s.get(m.teamB);
      b.sw += m.setsB; b.sl += m.setsA; b.pf += m.pointsB; b.pa += m.pointsA;
      if (m.setsB > m.setsA) b.wins++;
    }
  }
  return s;
}

// Per-team value of one tie-break criterion (higher = better).
export function criterionValues(key, teams, games) {
  const h2h = key.startsWith("H2H_");
  const matches = h2h
    ? games.filter((m) => teams.includes(m.teamA) && teams.includes(m.teamB))
    : games;
  const s = aggregate(teams, matches);
  const ratio = (a, b) => (b > 0 ? a / b : a > 0 ? Infinity : 0);
  const out = new Map();
  for (const t of teams) {
    const st = s.get(t);
    let v = 0;
    switch (key) {
      case "H2H_SET_DIFF": case "SET_DIFF": v = st.sw - st.sl; break;
      case "H2H_SET_RATIO": case "SET_RATIO": v = ratio(st.sw, st.sl); break;
      case "H2H_POINT_DIFF": case "POINT_DIFF": v = st.pf - st.pa; break;
      case "H2H_POINT_RATIO": case "POINT_RATIO": v = ratio(st.pf, st.pa); break;
      case "WINS": v = st.wins; break;
    }
    out.set(t, v);
  }
  return out;
}

// Order teams tied on points using the criteria chain. Head-to-head criteria
// are recomputed among whatever subset is still tied: when a criterion splits
// the group, each subgroup restarts the chain (so "between the teams concerned"
// always means the current subset). Terminates — subgroups strictly shrink.
export function breakTies(teams, chain, games) {
  if (teams.length <= 1) return teams.slice();
  for (const key of chain) {
    const vals = criterionValues(key, teams, games);
    const distinct = new Set([...vals.values()]);
    if (distinct.size === 1) continue;                        // doesn't separate
    const sorted = [...teams].sort((a, b) => vals.get(b) - vals.get(a) || a.localeCompare(b));
    const out = [];
    for (let i = 0; i < sorted.length;) {
      let j = i + 1;
      while (j < sorted.length && vals.get(sorted[j]) === vals.get(sorted[i])) j++;
      const cluster = sorted.slice(i, j);
      out.push(...(cluster.length > 1 ? breakTies(cluster, chain, games) : cluster));
      i = j;
    }
    return out;
  }
  return [...teams].sort((a, b) => a.localeCompare(b));        // fully tied → lots (stable)
}

export function computeStandings(matches, category, rules, { groupRounds, isRealTeam }) {
  const allGames = matches.filter(
    (m) => m.category === category &&
      groupRounds.includes(m.round) &&
      isRealTeam(m.teamA) && isRealTeam(m.teamB)
  );
  if (!allGames.length) return null;
  const games = allGames.filter(isFinished);

  const tbl = new Map();
  const ensure = (name) => {
    if (!tbl.has(name)) tbl.set(name, {
      team: name, played: 0, wins: 0, draws: 0, losses: 0,
      setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, pts: 0,
    });
    return tbl.get(name);
  };
  for (const g of allGames) { ensure(g.teamA); ensure(g.teamB); }

  for (const g of games) {
    const a = ensure(g.teamA), b = ensure(g.teamB);
    a.played++; b.played++;
    a.setsWon += g.setsA; a.setsLost += g.setsB;
    b.setsWon += g.setsB; b.setsLost += g.setsA;
    a.pointsFor += g.pointsA; a.pointsAgainst += g.pointsB;
    b.pointsFor += g.pointsB; b.pointsAgainst += g.pointsA;
    a.pts += matchPointsFor(g, g.setsA, g.setsB, rules);
    b.pts += matchPointsFor(g, g.setsB, g.setsA, rules);
    if (g.setsA > g.setsB) { a.wins++; b.losses++; }
    else if (g.setsB > g.setsA) { b.wins++; a.losses++; }
    else { a.draws++; b.draws++; }
  }

  // Primary order by points; equal-points clusters resolved by the chain.
  const byName = new Map([...tbl.values()].map((r) => [r.team, r]));
  const order = [...tbl.values()].sort((x, y) => y.pts - x.pts || x.team.localeCompare(y.team));
  const result = [];
  for (let i = 0; i < order.length;) {
    let j = i + 1;
    while (j < order.length && order[j].pts === order[i].pts) j++;
    const cluster = order.slice(i, j).map((r) => r.team);
    const ranked = cluster.length > 1 ? breakTies(cluster, rules.tiebreakers, games) : cluster;
    for (const name of ranked) result.push(byName.get(name));
    i = j;
  }
  return result;
}

export function groupTeams(matches, category, { groupRounds, isRealTeam }) {
  const set = new Set();
  for (const m of matches) {
    if (m.category === category && groupRounds.includes(m.round) &&
        isRealTeam(m.teamA) && isRealTeam(m.teamB)) {
      set.add(m.teamA); set.add(m.teamB);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// The head-to-head match between two teams in a category's group stage.
export function headToHead(matches, category, t1, t2, groupRounds) {
  return matches.find((m) =>
    m.category === category && groupRounds.includes(m.round) &&
    ((m.teamA === t1 && m.teamB === t2) || (m.teamA === t2 && m.teamB === t1)));
}

/* ---------------------- Knockout / bracket ---------------------- */

export function knockoutMatches(matches, category, groupRounds) {
  return matches.filter((m) =>
    m.category === category && !groupRounds.includes(m.round));
}

// Classify a knockout round into a tree stage (medal path) or a list stage.
export function knockoutStage(round) {
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
