/**
 * Human-readable French durations for e-mails. Durations are stored in
 * minutes everywhere (services, link expiries), and printing that number raw
 * sent clients and staff things like "1440 minutes" or "422 min".
 */

function toWholeMinutes(minutes) {
  const n = Math.round(Number(minutes));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Compact form for a table cell: "45 min", "2 h", "7 h 02".
 *
 * @param {number} minutes
 * @returns {string} "" when there is no positive duration
 */
export function formatDurationShort(minutes) {
  const total = toWholeMinutes(minutes);
  if (total == null) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * Sentence form: "15 minutes", "1 heure", "24 heures", "1 heure 30 minutes".
 * Whole days of 48 h or more read as days ("3 jours").
 *
 * @param {number} minutes
 * @returns {string} "" when there is no positive duration
 */
export function formatDurationLong(minutes) {
  const total = toWholeMinutes(minutes);
  if (total == null) return "";
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  if (total >= 48 * 60 && total % (24 * 60) === 0) return plural(total / (24 * 60), "jour");
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return plural(m, "minute");
  if (m === 0) return plural(h, "heure");
  return `${plural(h, "heure")} ${plural(m, "minute")}`;
}
