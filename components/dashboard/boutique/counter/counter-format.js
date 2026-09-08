/**
 * Formatting + label helpers shared by the counter's fiche components
 * (CounterFiche, FicheSettleAction, PickupFiche, CounterResults). Extracted
 * out of CounterPanel.jsx when it split into one file per concern, so each
 * piece doesn't carry its own copy of the same three functions.
 */

export function formatPrice(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-BE", {
    timeZone: "Europe/Brussels",
    dateStyle: "full",
    timeStyle: "short",
  });
}

export function isToday(value) {
  if (!value) return false;
  const opts = { timeZone: "Europe/Brussels" };
  return new Date(value).toLocaleDateString("fr-BE", opts) === new Date().toLocaleDateString("fr-BE", opts);
}

export const KIND_LABEL = {
  appointment: "Rendez-vous",
  workshop: "Atelier / Événement",
  formation: "Formation",
};
