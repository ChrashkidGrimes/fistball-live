/* Pure selection logic for the Live tab and the score-pulse diff. */
import { isLive } from './meta.js';

export function selectLive(matches) {
  return matches.filter(isLive);
}

export function selectUpNext(matches, n) {
  return matches.filter((m) => m.status === 'Not Started').slice(0, n);
}

export function groupByCourt(matches) {
  const byCourt = new Map();
  const ensure = (court) => {
    if (!byCourt.has(court)) byCourt.set(court, { court, live: [], upNext: [] });
    return byCourt.get(court);
  };
  for (const m of matches) {
    const court = m.court ? String(m.court) : null;
    if (isLive(m)) ensure(court).live.push(m);
    else if (m.status === 'Not Started') {
      const g = ensure(court);
      if (g.upNext.length < 2) g.upNext.push(m);
    }
  }
  const named = [...byCourt.values()].filter((g) => g.court !== null)
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));
  const nullGroup = byCourt.get(null);
  return nullGroup ? [...named, nullGroup] : named;
}

export function changedMatchIds(oldMatches, newMatches) {
  const prev = new Map(oldMatches.map((m) => [m.id, m]));
  const changed = new Set();
  for (const m of newMatches) {
    const p = prev.get(m.id);
    if (!p) continue;
    if (p.setsA !== m.setsA || p.setsB !== m.setsB ||
        p.pointsA !== m.pointsA || p.pointsB !== m.pointsB ||
        p.status !== m.status) changed.add(m.id);
  }
  return changed;
}
