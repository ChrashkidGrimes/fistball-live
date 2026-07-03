export const DEFAULT_TIEBREAKERS = [
  'H2H_SET_DIFF', 'H2H_SET_RATIO', 'H2H_POINT_DIFF',
  'SET_DIFF', 'SET_RATIO', 'POINT_DIFF',
];
export const DEFAULT_RULES = { pointTable: [], drawPoints: 1, tiebreakers: DEFAULT_TIEBREAKERS.slice() };

export function statusLabel(status) {
  if (status === 'live') return 'In progress';
  if (status === 'finished') return 'Finished';
  return 'Not Started';
}

export function sourceLabel(sourceMatch, outcome) {
  if (!sourceMatch) return '—';
  const label = sourceMatch.sheet_match_nr ? `#${sourceMatch.sheet_match_nr}` : (sourceMatch.round_label || 'Match');
  return outcome === 'winner' ? `Sieger von ${label}` : `Verlierer von ${label}`;
}

// A team is a real entrant, not a bracket placeholder. Placeholders are the
// "Sieger von .../Verlierer von ..." strings sourceLabel() produces above —
// real team/country names never start with either phrase.
export function isRealTeam(name) {
  if (!name) return false;
  return !/^(Sieger von|Verlierer von)\s/.test(name);
}

export function mapMatch(row) {
  const sets = (row.sets || []).slice().sort((a, b) => a.set_number - b.set_number);
  let setsA = 0, setsB = 0, pointsA = 0, pointsB = 0;
  const setPairs = [];
  for (const s of sets) {
    pointsA += s.points_a;
    pointsB += s.points_b;
    if (s.winner_team_id === row.team_a_id) setsA++;
    else if (s.winner_team_id === row.team_b_id) setsB++;
    setPairs.push([s.points_a, s.points_b]);
  }

  let day = '', time = '';
  if (row.scheduled_time) {
    const dt = new Date(row.scheduled_time);
    day = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return {
    day, time,
    nr: row.sheet_match_nr || row.id.slice(0, 8),
    court: row.court?.name || '',
    teamA: row.team_a ? row.team_a.name : sourceLabel(row.team_a_source_match, row.team_a_source_outcome),
    teamB: row.team_b ? row.team_b.name : sourceLabel(row.team_b_source_match, row.team_b_source_outcome),
    round: row.round_label || '',
    category: row.categories?.name || '',
    bestOf: row.best_of,
    setsA, setsB,
    pointsA, pointsB,
    sets: setPairs,
    status: statusLabel(row.status),
  };
}

export function mapCautions(rows) {
  const players = new Map();
  for (const r of rows) {
    // Nested joins (player/team/category) can be null on malformed or
    // partial rows — guard with optional chaining so one bad row can't
    // throw and take down the whole viewer. Skip rows with no player at all.
    if (!r.player_id || !r.player) continue;
    if (!players.has(r.player_id)) {
      players.set(r.player_id, {
        team: r.player.team?.name || '',
        teamName: r.player.team?.name || '',
        category: r.player.team?.category?.name || '',
        nr: r.player.jersey_number ?? '',
        name: r.player.family_name || '',
        first: r.player.given_name || '',
        y: 0, yr: 0, r: 0, events: [],
      });
    }
    const p = players.get(r.player_id);
    const key = r.event_type === 'Y' ? 'y' : r.event_type === 'YR' ? 'yr' : 'r';
    p[key]++;
    p.events.push({ game: r.match?.round_label || '', type: r.event_type });
  }
  return [...players.values()];
}

const TIEBREAK_ALIASES = {
  H2H_SET_DIFF: 'H2H_SET_DIFF', H2H_SET_DIFFERENCE: 'H2H_SET_DIFF',
  H2H_SET_RATIO: 'H2H_SET_RATIO', H2H_SET_QUOTIENT: 'H2H_SET_RATIO',
  H2H_POINT_DIFF: 'H2H_POINT_DIFF', H2H_POINT_DIFFERENCE: 'H2H_POINT_DIFF',
  H2H_POINT_RATIO: 'H2H_POINT_RATIO', H2H_POINT_QUOTIENT: 'H2H_POINT_RATIO',
  SET_DIFF: 'SET_DIFF', SET_DIFFERENCE: 'SET_DIFF',
  SET_RATIO: 'SET_RATIO', SET_QUOTIENT: 'SET_RATIO',
  POINT_DIFF: 'POINT_DIFF', POINT_DIFFERENCE: 'POINT_DIFF',
  POINT_RATIO: 'POINT_RATIO', POINT_QUOTIENT: 'POINT_RATIO',
  WINS: 'WINS',
};
const tbKey = (raw) => TIEBREAK_ALIASES[String(raw).trim().toUpperCase().replace(/[\s.\-]+/g, '_')] || null;

export function rulesFromConfig(config) {
  const out = {
    pointTable: DEFAULT_RULES.pointTable,
    drawPoints: DEFAULT_RULES.drawPoints,
    tiebreakers: DEFAULT_TIEBREAKERS.slice(),
  };
  if (!config) return out;
  if (Array.isArray(config.pointTable) && config.pointTable.length) out.pointTable = config.pointTable;
  if (typeof config.drawPoints === 'number') out.drawPoints = config.drawPoints;
  if (Array.isArray(config.tiebreakers) && config.tiebreakers.length) {
    const list = config.tiebreakers.map(tbKey).filter(Boolean);
    if (list.length) out.tiebreakers = list;
  }
  return out;
}
