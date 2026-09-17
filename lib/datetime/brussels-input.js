/**
 * `<input type="datetime-local">` holds a wall-clock time with no timezone:
 * "2026-10-23T09:00". The salon means Brussels time by it — always, whatever
 * the browser or the server happens to run in. These two helpers are the only
 * conversion between that string and a stored instant, and they are exact
 * inverses of each other.
 *
 * Why this exists (17/09/2026): the formation and atelier edit forms
 * prefilled the field with `date.toISOString().slice(0, 16)` — the UTC wall
 * time — while the save read the string back as Brussels time. A session at
 * 09:00 Brussels (07:00Z in October) showed as "07:00" in the form, and saving
 * the form unchanged stored 07:00 BRUSSELS. Every save moved every session 2h
 * earlier in summer, 1h in winter: "Un après-midi chez Mamie" ended up at
 * 04:00, and a Manucure Russe session at midnight.
 *
 * Pure `Intl` — no dependency, safe in both client and server components.
 */

const TIME_ZONE = "Europe/Brussels";
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const pad = (n) => String(n).padStart(2, "0");

/** The Brussels wall-clock parts of an instant. */
function brusselsParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/**
 * A stored instant → the value a datetime-local input should show, in
 * Brussels time. "" for anything that isn't a valid date.
 */
export function toBrusselsInputValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = brusselsParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * A datetime-local value (Brussels wall clock) → the instant it names.
 *
 * A string that already carries its zone ("…Z", "…+02:00") is an instant
 * already and is taken as such, so a caller that sends a full ISO string
 * keeps working. Returns null for empty or unparseable input.
 *
 * Across the autumn change the wall clock repeats an hour (02:00–03:00 on
 * 25/10/2026); the earlier, summer-time reading is chosen. In spring an hour
 * doesn't exist (02:00–03:00 on 29/03/2026); it resolves to the instant an
 * hour later, as a clock that jumped forward would read it.
 */
export function parseBrusselsInputValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;

  const match = WALL_CLOCK.exec(text);
  if (!match) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const [, y, mo, d, h, mi, s] = match.map((part) => (part === undefined ? 0 : Number(part)));
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const wanted = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;

  // Brussels is only ever UTC+2 (summer) or UTC+1 (winter), so the instant is
  // one of exactly two candidates: whichever reads back as the wall time
  // typed. Summer first, so the repeated autumn hour takes its earlier reading.
  const HOUR = 60 * 60 * 1000;
  for (const offset of [2 * HOUR, HOUR]) {
    const candidate = new Date(wallAsUtc - offset);
    if (toBrusselsInputValue(candidate) === wanted) return candidate;
  }
  // Neither reads back: a spring-forward wall time that never happened.
  return new Date(wallAsUtc - HOUR);
}
