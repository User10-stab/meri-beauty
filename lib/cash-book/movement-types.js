/**
 * Display labels for the three off-sale drawer movement kinds, shared
 * between the recording form and the server action so the auto-generated
 * Désignation ("Apport", "Apport: fond de caisse"...) always matches what
 * the dropdown shows.
 */
export const CASH_MOVEMENT_TYPE_LABELS = {
  EXPENSE: "Dépense",
  CASH_IN: "Apport",
  WITHDRAWAL: "Transfert de banque",
};

/** Builds the stored Désignation: the type name alone, or "Type: motif" when a motif was typed. */
export function buildCashMovementLabel(type, motif) {
  const typeLabel = CASH_MOVEMENT_TYPE_LABELS[type] ?? type;
  const trimmed = typeof motif === "string" ? motif.trim() : "";
  return trimmed ? `${typeLabel}: ${trimmed}` : typeLabel;
}
