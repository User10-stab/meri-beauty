// Shared weekday helpers for StaffService.availableDays.

export const ALL_WEEK_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const FULL_LABELS_FR = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

/**
 * Formats a StaffService.availableDays array into a human-readable French
 * label, e.g. "Mercredi" or "Lundi, Mercredi, Vendredi". Empty/null or all
 * 7 days both mean "no restriction" and render as "Tous les jours".
 *
 * @param {Array<string>} [days]
 * @returns {string}
 */
export function formatAvailableDays(days) {
  const unique = new Set(days ?? []);
  if (unique.size === 0 || unique.size >= ALL_WEEK_DAYS.length) return "Tous les jours";
  return ALL_WEEK_DAYS.filter((d) => unique.has(d))
    .map((d) => FULL_LABELS_FR[d])
    .join(", ");
}
