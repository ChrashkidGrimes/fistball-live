// Pure parsing functions for the public tournament Google Sheet. No network
// or database access here — scripts/migrate-sheet-data.mjs does the I/O and
// calls into these. Deliberately duplicated (not imported) from app.js's
// CSV/row parsing, since app.js is a browser global script, not a module,
// and the viewer app is out of scope for this teilprojekt to touch.

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* ignore */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (v) => {
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

function cleanTeam(name, category) {
  if (!name) return name;
  let n = name.trim();
  if (category && n.endsWith(' - ' + category)) {
    n = n.slice(0, -(' - ' + category).length);
  } else {
    const m = n.match(/^(.*?) - (U18 .*|WEC)$/);
    if (m) n = m[1];
  }
  return n.trim();
}

const STATUS_MAP = {
  'Not Started': 'scheduled',
  'Starting': 'live',
  'In progress': 'live',
  'Finished': 'finished',
};

export function mapStatus(sheetStatus) {
  return STATUS_MAP[sheetStatus] || 'scheduled';
}

const STATUS_VALUES = Object.keys(STATUS_MAP);
const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// Combines the sheet's "Thursday - 23 Jul  2026" + "10:00" into an ISO
// timestamp. The event is in Reiden, Switzerland in July (CEST, UTC+2) —
// hardcoded here since this is a one-off script for this specific event,
// not a general-purpose date parser.
function toScheduledTimeIso(day, time) {
  const m = day.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  const t = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return null;
  const [, d, monAbbr, y] = m;
  const month = MONTHS[monAbbr];
  if (!month) return null;
  const dd = d.padStart(2, '0');
  return new Date(`${y}-${month}-${dd}T${t[1].padStart(2, '0')}:${t[2]}:00+02:00`).toISOString();
}

// Row shape mirrors app.js's rowToMatch column layout (see fistball-live/app.js).
export function parseScheduleRow(r) {
  const nr = num(r[2]);
  const teamA = (r[4] || '').trim();
  const teamB = (r[5] || '').trim();
  const category = (r[7] || '').trim();
  if (!nr || !teamA || !teamB || !category) return null;

  let status = 'Not Started';
  for (const cell of r) {
    const t = (cell || '').trim();
    if (STATUS_VALUES.includes(t)) { status = t; break; }
  }

  const day = (r[0] || '').trim();
  const time = (r[1] || '').trim();

  return {
    nr,
    court: (r[3] || '').trim(),
    teamA: cleanTeam(teamA, category),
    teamB: cleanTeam(teamB, category),
    round: (r[6] || '').trim(),
    category,
    bestOf: num(r[8]),
    setsA: num(r[9]),
    setsB: num(r[11]),
    status,
    day,
    time,
  };
}

export function parseTournamentConfig(csvText) {
  const rows = parseCSV(csvText);
  const categories = [];
  for (let r = 0; r < rows.length; r++) {
    const hdr = rows[r];
    const col = hdr.findIndex((c) => String(c || '').trim() === 'Team');
    if (col === -1) continue;
    for (let k = r + 1; k < rows.length; k++) {
      const name = String(rows[k][col] || '').trim();
      if (!name) break;
      categories.push(name);
    }
    break;
  }
  return { categories, pointTable: [], drawPoints: 1, tiebreakers: [] };
}

export function buildMigrationPlan(scheduleCsvText) {
  const rows = parseCSV(scheduleCsvText).map(parseScheduleRow).filter(Boolean);

  const categories = [...new Set(rows.map((r) => r.category))];
  const courts = [...new Set(rows.map((r) => r.court).filter(Boolean))];

  const teamKey = (name, category) => `${category}::${name}`;
  const teamsByKey = new Map();
  for (const r of rows) {
    for (const name of [r.teamA, r.teamB]) {
      const key = teamKey(name, r.category);
      if (!teamsByKey.has(key)) teamsByKey.set(key, { name, category: r.category });
    }
  }

  const matches = rows.map((r) => ({
    ...r,
    scheduledTimeIso: toScheduledTimeIso(r.day, r.time),
  }));

  return { categories, courts, teams: [...teamsByKey.values()], matches };
}
