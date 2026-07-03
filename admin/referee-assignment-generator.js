export function assignReferees({ matches, referees, existingAssignments, roles }) {
  const countAssignments = new Map();
  for (const r of referees) countAssignments.set(r.id, 0);
  for (const a of existingAssignments) {
    countAssignments.set(a.referee_id, (countAssignments.get(a.referee_id) || 0) + 1);
  }

  const matchesById = new Map(matches.map((m) => [m.id, m]));

  const assignedAtTime = new Set();
  for (const a of existingAssignments) {
    const m = matchesById.get(a.match_id);
    if (m && m.scheduled_time) assignedAtTime.add(`${a.referee_id}|${m.scheduled_time}`);
  }

  const inMatch = new Map();
  for (const a of existingAssignments) {
    if (!inMatch.has(a.match_id)) inMatch.set(a.match_id, { roles: new Set(), refereeIds: new Set() });
    inMatch.get(a.match_id).roles.add(a.role);
    inMatch.get(a.match_id).refereeIds.add(a.referee_id);
  }

  const sortedMatches = [...matches].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));
  const uniqueTimes = [...new Set(sortedMatches.filter((m) => m.scheduled_time).map((m) => m.scheduled_time))].sort();
  const timeIndex = new Map(uniqueTimes.map((t, i) => [t, i]));

  const lastSlotByReferee = new Map();
  for (const a of existingAssignments) {
    const m = matchesById.get(a.match_id);
    if (m && m.scheduled_time && timeIndex.has(m.scheduled_time)) {
      if (!lastSlotByReferee.has(a.referee_id)) lastSlotByReferee.set(a.referee_id, new Set());
      lastSlotByReferee.get(a.referee_id).add(timeIndex.get(m.scheduled_time));
    }
  }

  const results = [];

  for (const match of sortedMatches) {
    const matchState = inMatch.get(match.id) || { roles: new Set(), refereeIds: new Set() };
    inMatch.set(match.id, matchState);

    for (const role of roles) {
      if (matchState.roles.has(role)) continue;

      let best = null;
      let bestScore = Infinity;
      let bestCount = Infinity;

      for (const ref of referees) {
        if (matchState.refereeIds.has(ref.id)) continue;
        if (match.scheduled_time && assignedAtTime.has(`${ref.id}|${match.scheduled_time}`)) continue;
        const matchDate = match.scheduled_time ? match.scheduled_time.slice(0, 10) : null;
        if (matchDate && ref.available_from && matchDate < ref.available_from) continue;
        if (matchDate && ref.available_to && matchDate > ref.available_to) continue;

        let score = 0;
        if (role === '1st Referee') {
          const refCountry = ref.country.toLowerCase();
          const conflict =
            (match.team_a_name && match.team_a_name.toLowerCase() === refCountry) ||
            (match.team_b_name && match.team_b_name.toLowerCase() === refCountry);
          if (conflict) score += 100;
        }
        if (match.scheduled_time && timeIndex.has(match.scheduled_time)) {
          const idx = timeIndex.get(match.scheduled_time);
          if (lastSlotByReferee.has(ref.id) && lastSlotByReferee.get(ref.id).has(idx - 1)) score += 10;
        }

        const count = countAssignments.get(ref.id) || 0;
        if (score < bestScore || (score === bestScore && count < bestCount)) {
          best = ref;
          bestScore = score;
          bestCount = count;
        }
      }

      if (best) {
        results.push({ matchId: match.id, role, refereeId: best.id });
        matchState.roles.add(role);
        matchState.refereeIds.add(best.id);
        countAssignments.set(best.id, (countAssignments.get(best.id) || 0) + 1);
        if (match.scheduled_time) {
          assignedAtTime.add(`${best.id}|${match.scheduled_time}`);
          if (timeIndex.has(match.scheduled_time)) {
            if (!lastSlotByReferee.has(best.id)) lastSlotByReferee.set(best.id, new Set());
            lastSlotByReferee.get(best.id).add(timeIndex.get(match.scheduled_time));
          }
        }
      } else {
        results.push({ matchId: match.id, role, refereeId: null });
      }
    }
  }

  return results;
}
