/* Static lookup tables and small pure helpers shared across views. */

// Map of country -> flag emoji (best effort; falls back to none).
export const FLAGS = {
  "Austria": "🇦🇹", "Brazil": "🇧🇷", "Germany": "🇩🇪", "Switzerland": "🇨🇭",
  "Chile": "🇨🇱", "India": "🇮🇳", "Namibia": "🇳🇦", "Kenya": "🇰🇪",
  "New Zealand": "🇳🇿", "Italy": "🇮🇹", "Czech Republic": "🇨🇿", "Denmark": "🇩🇰",
  "Serbia": "🇷🇸",
};

// Short codes for the cross-table column headers.
export const CODES = {
  Austria: "AUT", Brazil: "BRA", Germany: "GER", Switzerland: "SUI", Chile: "CHI",
  India: "IND", Namibia: "NAM", Kenya: "KEN", "New Zealand": "NZL", Italy: "ITA",
  "Czech Republic": "CZE", Denmark: "DEN", Serbia: "SRB",
};
export const codeFor = (t) => CODES[t] || t.slice(0, 3).toUpperCase();

export function flagFor(team) {
  return FLAGS[team] || "";
}

export function genderOf(cat) {
  if (cat === "WEC" || /\b(w|women)\b/i.test(cat)) return "women";
  if (/\b(m|men)\b/i.test(cat)) return "men";
  return "other";
}

// Category chips are grouped into two rows (Women, then Men) and ordered
// within each row following this list (the order used in the sheet).
export const CATEGORY_ORDER = [
  // Women
  "WEC", "U18 W Gold", "U18 W Silver", "U18 Women", "P 7-9 Women",
  // Men
  "U18 M Gold", "U18 M Silver", "U18 Men", "P 7-9 Men",
];
export function orderIndex(cat) {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? 999 : i;
}

// Rounds that form a round-robin group stage (used to compute standings).
export const GROUP_ROUNDS = ["Qualification round", "WEC - Vorrunde"];

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function statusClass(s) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}
export function isFinished(m) { return m.status === "Finished"; }
export function isLive(m) { return m.status === "In progress" || m.status === "Starting"; }
