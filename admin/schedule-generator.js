export function computeRoundRobinRounds(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2 !== 0) ids.push(null);
  const n = ids.length;
  const rounds = [];
  const fixed = ids[0];
  let rest = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const roundTeams = [fixed, ...rest];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = roundTeams[i];
      const b = roundTeams[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)];
  }
  return rounds;
}

export function assignScheduleSlots({ rounds, courtIds, startTime, endTime, matchDurationMinutes, breakMinutes, existingMatches }) {
  const stepMs = (matchDurationMinutes + breakMinutes) * 60000;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  const courtBusy = new Set();
  const teamBusy = new Set();
  for (const m of existingMatches) {
    if (!m.scheduled_time) continue;
    const iso = new Date(m.scheduled_time).toISOString();
    if (m.court_id) courtBusy.add(`${m.court_id}|${iso}`);
    if (m.team_a_id) teamBusy.add(`${m.team_a_id}|${iso}`);
    if (m.team_b_id) teamBusy.add(`${m.team_b_id}|${iso}`);
  }

  const assignments = [];
  let missingSlots = 0;

  for (const round of rounds) {
    for (const [teamA, teamB] of round) {
      let placed = false;
      for (let time = start; time <= end; time += stepMs) {
        const iso = new Date(time).toISOString();
        if (teamBusy.has(`${teamA}|${iso}`) || teamBusy.has(`${teamB}|${iso}`)) continue;
        const courtId = courtIds.find((c) => !courtBusy.has(`${c}|${iso}`));
        if (!courtId) continue;
        assignments.push({ teamA, teamB, courtId, scheduledTime: iso });
        courtBusy.add(`${courtId}|${iso}`);
        teamBusy.add(`${teamA}|${iso}`);
        teamBusy.add(`${teamB}|${iso}`);
        placed = true;
        break;
      }
      if (!placed) missingSlots++;
    }
  }

  if (missingSlots > 0) return { ok: false, missingSlots };
  return { ok: true, assignments };
}
