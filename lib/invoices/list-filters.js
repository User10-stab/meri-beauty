import { SHIPPED_ORDER_STATUSES } from "@/lib/refunds/authorize";

/**
 * Filters for the Factures page (/dashboard/factures). Kept out of the
 * "use server" action so the where-builder and the per-row eligibility rules
 * can be unit-tested against plain objects.
 */

export const INVOICES_PAGE_SIZE = 25;

export const INVOICE_DELIVERY_FILTERS = Object.freeze(["ALL", "UNSENT", "SENT", "PEPPOL_PENDING", "CREDITED"]);
export const INVOICE_SOURCE_FILTERS = Object.freeze(["ALL", "ORDER", "APPOINTMENT", "WORKSHOP", "FORMATION", "STAFF_CONTRACT", "MANUAL"]);

export const INVOICE_SOURCE_LABELS = Object.freeze({
  ORDER: "Boutique",
  APPOINTMENT: "Rendez-vous",
  WORKSHOP: "Atelier",
  FORMATION: "Formation",
  STAFF_CONTRACT: "Contrat staff",
  MANUAL: "Facture manuelle",
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : "ALL";
}

/**
 * Local day bounds. Process TZ is pinned to Europe/Brussels
 * (instrumentation.js), the same convention lib/livre-de-recettes/filters.js
 * relies on — so this stays right across the summer/winter time change.
 */
function brusselsDayStart(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}
function brusselsDayEnd(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

export function normalizeInvoiceFilters(raw = {}) {
  const page = Math.max(1, Number.parseInt(raw.page, 10) || 1);
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 100) : "";
  return {
    page,
    q,
    delivery: pick(raw.delivery, INVOICE_DELIVERY_FILTERS),
    source: pick(raw.source, INVOICE_SOURCE_FILTERS),
    from: typeof raw.from === "string" && DATE_RE.test(raw.from) ? raw.from : "",
    to: typeof raw.to === "string" && DATE_RE.test(raw.to) ? raw.to : "",
  };
}

export function buildInvoiceWhere(filters) {
  const and = [];

  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" };
    and.push({
      OR: [
        { number: contains },
        { customerName: contains },
        { customerEmail: contains },
        { customerLegalName: contains },
        { customerVatNumber: contains },
      ],
    });
  }
  if (filters.source !== "ALL") and.push({ source: filters.source });

  if (filters.from || filters.to) {
    and.push({
      issuedAt: {
        ...(filters.from ? { gte: brusselsDayStart(filters.from) } : {}),
        ...(filters.to ? { lte: brusselsDayEnd(filters.to) } : {}),
      },
    });
  }

  switch (filters.delivery) {
    case "UNSENT":
      and.push({ emailSentAt: null, peppyrusSentAt: null });
      break;
    case "SENT":
      and.push({ OR: [{ emailSentAt: { not: null } }, { peppyrusSentAt: { not: null } }] });
      break;
    case "PEPPOL_PENDING":
      // Same rule as isBelgianVatNumber (lib/peppyrus.js): B2B + a BE number.
      and.push({ customerType: "B2B", customerVatNumber: { startsWith: "BE", mode: "insensitive" }, peppyrusSentAt: null });
      break;
    case "CREDITED":
      and.push({ creditNotes: { some: {} } });
      break;
    default:
      break;
  }

  return and.length ? { AND: and } : {};
}

/**
 * Whether "Générer une note de crédit" may be offered on this invoice.
 * Mirrors TransactionDetailDrawer's canGenerateCreditNote: the one path is
 * cancelAndRefund's POST_COMPLETION_CORRECTION, which needs a payment, a
 * finished item, and no refund operation already open. A contract invoice
 * has no payment and so no such path; a superseded invoice has already been
 * corrected; a fully credited one has nothing left to credit.
 */
export function creditNoteEligibility(invoice) {
  if (invoice.supersededAt) return { allowed: false, reason: "Facture remplacée." };
  const credited = (invoice.creditNotes ?? []).reduce((sum, note) => sum + Number(note.totalInclVat ?? 0), 0);
  const fullyCredited = credited + 0.01 >= Number(invoice.totalInclVat ?? 0);

  // A rent invoice has no sale to cancel: it is corrected on its own, before
  // or after payment, as many times as needed until fully credited
  // (actions/invoices/staff-rent.js#creditStaffRentInvoice).
  if (invoice.source === "STAFF_CONTRACT") {
    return fullyCredited ? { allowed: false, reason: "Facture entièrement créditée." } : { allowed: true, reason: null };
  }
  if (!invoice.paymentId) return { allowed: false, reason: "Aucun paiement lié (facture de contrat)." };
  if (fullyCredited) return { allowed: false, reason: "Facture entièrement créditée." };
  if ((invoice.refundOperationCount ?? 0) > 0) return { allowed: false, reason: "Une annulation est déjà en cours sur ce paiement." };

  const status = invoice.itemStatus ?? null;
  const finished = invoice.itemKind === "ORDER" ? SHIPPED_ORDER_STATUSES.has(status) : status === "COMPLETED";
  if (!finished) return { allowed: false, reason: "L'élément n'est pas encore terminé — utilisez « Annuler et rembourser » dans Opérations." };

  return { allowed: true, reason: null };
}
