/**
 * Invoice / credit-note issuance.
 *
 * Call `issueInvoice`/`issueCreditNote` from INSIDE the same
 * `prisma.$transaction` that settles the payment (or cancels the order) —
 * never standalone. Belgian TVA law requires a truly gapless sequence: the
 * numbering counter is incremented with the document row in one DB
 * transaction, so a rollback (payment race, validation failure, etc.) never
 * burns a number. Never call these outside a transaction.
 */

import { BELGIUM_VAT_RATE, calculateVatTotals } from "@/lib/tax-policy";
import { formatSalonAddress, formatUserAddress } from "@/lib/format-address";
import { prisma } from "@/lib/prisma";

/**
 * Builds the `customer` object issueInvoice() expects from a User row that
 * includes `billingProfile` — every call site was hand-assembling this same
 * shape independently (fullName/email/vatNumber/address), which is exactly
 * how the B2B fields would have drifted the moment only some of the 6
 * call sites remembered to add them. `vatNumberOverride` covers the one
 * real variation: boutique orders snapshot the VAT number used at checkout
 * time (`order.customerVatNumber`) rather than the user's current one.
 *
 * @param {object} user - fullName, email, vatNumber, address fields, isCompany, billingProfile
 * @param {{ vatNumberOverride?: string|null }} [opts]
 */
export function buildInvoiceCustomer(user, { vatNumberOverride } = {}) {
  return {
    fullName: user.fullName,
    email: user.email,
    vatNumber: vatNumberOverride !== undefined ? vatNumberOverride : user.vatNumber,
    address: formatUserAddress(user),
    isCompany: user.isCompany,
    legalName: user.billingProfile?.companyLegalName ?? null,
    companyRegistrationNo: user.billingProfile?.companyRegistrationNo ?? null,
    billingContactName: user.billingProfile?.billingContactName ?? null,
    purchaseOrderReference: user.billingProfile?.purchaseOrderReference ?? null,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Builds a 1- or 2-line invoice-line array for a single service (appointment/
 * workshop/formation) at its catalogue price, with a promo discount shown as
 * its own negative line rather than silently baked into the unit price —
 * mirrors lib/orders/fulfill-order-payment.js#orderInvoiceLines' pattern for
 * boutique orders. `totalAmount` is the amount actually charged (already net
 * of the discount, e.g. Payment.totalAmount/Reservation.totalPrice).
 *
 * @param {{ description: string, totalAmount: number, discountAmount?: number }} input
 */
export function buildServiceInvoiceLines({ description, totalAmount, discountAmount = 0 }) {
  const discount = round2(Number(discountAmount) || 0);
  const lines = [
    { description, quantity: 1, unitPrice: round2(Number(totalAmount) + discount) },
  ];
  if (discount > 0) {
    lines.push({ description: "Code promotionnel", quantity: 1, unitPrice: -discount });
  }
  return lines;
}

/**
 * Atomic INSERT..ON CONFLICT..RETURNING — safe under concurrent callers.
 *
 * `new Date().getFullYear()` here resolves the *process-local* year, which
 * is only Brussels-correct because instrumentation.js pins
 * `process.env.TZ = "Europe/Brussels"` once at server startup, before
 * anything touches a Date — see that file's comment. Don't "fix" this by
 * reaching for `new Date().getUTCFullYear()` or similar; that would break
 * the invariant this already relies on. If that pin is ever removed, this
 * needs an explicit `Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels",
 * year: "numeric" })` instead.
 */
async function nextSequenceNumber(tx, series) {
  const year = new Date().getFullYear();
  const key = `${series}-${year}`;
  const rows = await tx.$queryRaw`
    INSERT INTO "NumberingCounter" ("key", "lastNumber") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return { year, seq: Number(rows[0].lastNumber) };
}

const SALON_SELECT = {
  name: true,
  vatNumber: true,
  legalName: true,
  companyRegistrationNo: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  city: true,
  countryCode: true,
};

/**
 * True once the seller's legal identity has every field issueInvoice()
 * requires. Call this BEFORE creating a Stripe Checkout Session (boutique,
 * appointment, atelier, formation) — issueInvoice() only runs from inside
 * the payment webhook, after the customer has already paid, so discovering
 * an incomplete profile there is too late: the charge is already captured,
 * the webhook throws and retries for days, and the only way the customer
 * gets their money back is expireStaleOrders eventually refunding it —
 * having paid for nothing and heard nothing in between. Checking here means
 * checkout is refused up front, before any card is charged.
 */
export async function isSellerLegalDataComplete() {
  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: SALON_SELECT });
  return Boolean(
    salon?.legalName && salon?.vatNumber && salon?.addressLine1 && salon?.postalCode && salon?.city && salon?.countryCode
  );
}

/**
 * @param {object} tx - Prisma transaction client
 * @param {{
 *   paymentId: string,
 *   source: "ORDER" | "APPOINTMENT",
 *   totalInclVat: number,
 *   customer: {
 *     fullName: string, email: string, vatNumber?: string|null, address?: string|null,
 *     isCompany?: boolean, legalName?: string|null, companyRegistrationNo?: string|null,
 *     billingContactName?: string|null, purchaseOrderReference?: string|null,
 *   },
 *   lines: { description: string, quantity: number, unitPrice: number }[],
 *   vatRate?: number,
 *   vatTreatment?: "DOMESTIC"|"EU_DISTANCE_SALE"|"EU_REVERSE_CHARGE"|"EXPORT",
 *   taxCountryCode?: string,
 *   taxNote?: string|null,
 * }} input
 */
export async function issueInvoice(tx, {
  paymentId,
  source,
  totalInclVat,
  customer,
  lines,
  vatRate = BELGIUM_VAT_RATE,
  vatTreatment = "DOMESTIC",
  taxCountryCode = "BE",
  taxNote = null,
}) {
  const salon = await tx.salon.findUnique({ where: { id: "main-salon" }, select: SALON_SELECT });

  // A legally incomplete invoice is worse than a failed sale — better to
  // block fulfillment (payment stays captured, retry once the admin fills
  // in the settings form) than to hand a customer a document missing the
  // seller's registered name/address/VAT number.
  if (
    !salon?.legalName ||
    !salon?.vatNumber ||
    !salon?.addressLine1 ||
    !salon?.postalCode ||
    !salon?.city ||
    !salon?.countryCode
  ) {
    throw new Error("SELLER_LEGAL_DATA_INCOMPLETE");
  }

  const { year, seq } = await nextSequenceNumber(tx, "invoice");
  const number = `${year}-${String(seq).padStart(6, "0")}`;

  const totals = calculateVatTotals(totalInclVat, vatRate);

  // B2B when the customer has a company legal name on file (BillingProfile).
  // No live Peppol delivery yet (Phase B) — a B2B invoice is flagged on the
  // dashboard for manual entry into the accountant's Peppol-compatible
  // software, never silently treated like a B2C sale.
  const isB2B = Boolean(customer.isCompany && customer.legalName);

  return tx.invoice.create({
    data: {
      number,
      source,
      paymentId,
      sellerName: salon.legalName,
      sellerAddress: formatSalonAddress(salon),
      sellerVatNumber: salon.vatNumber,
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerVatNumber: customer.vatNumber ?? null,
      customerAddress: customer.address ?? null,
      customerType: isB2B ? "B2B" : "B2C",
      customerLegalName: isB2B ? customer.legalName : null,
      customerContactName: isB2B ? (customer.billingContactName || customer.fullName) : null,
      customerRegistrationNo: isB2B ? (customer.companyRegistrationNo ?? null) : null,
      purchaseOrderReference: isB2B ? (customer.purchaseOrderReference ?? null) : null,
      subtotalExclVat: totals.totalExclVat,
      vatRate,
      vatAmount: totals.vatAmount,
      totalInclVat: totals.totalInclVat,
      vatTreatment,
      taxCountryCode,
      taxNote,
      lines: {
        create: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: round2(line.unitPrice),
          lineTotal: round2(line.unitPrice * line.quantity),
        })),
      },
    },
    include: { lines: true },
  });
}

/**
 * @param {object} tx - Prisma transaction client
 * @param {{ invoiceId: string, reason?: string|null, totalInclVat: number }} input
 */
export async function issueCreditNote(tx, { invoiceId, reason, totalInclVat }) {
  const amount = round2(totalInclVat);

  // Defense in depth against over-crediting an invoice — the real
  // concurrency guard against double-claiming units lives at each caller
  // (e.g. requestReturn's row lock on the Order), this catches it even if
  // that guard ever slips or a new caller forgets it.
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { totalInclVat: true, vatRate: true } });
  if (!invoice) {
    throw new Error("CREDIT_NOTE_INVOICE_NOT_FOUND");
  }
  const { _sum } = await tx.creditNote.aggregate({ where: { invoiceId }, _sum: { totalInclVat: true } });
  const alreadyIssued = Number(_sum.totalInclVat ?? 0);
  const EPSILON = 0.01;
  if (alreadyIssued + amount > Number(invoice.totalInclVat) + EPSILON) {
    throw new Error("CREDIT_NOTE_EXCEEDS_INVOICE");
  }

  const { year, seq } = await nextSequenceNumber(tx, "creditnote");
  const number = `NC${year}-${String(seq).padStart(6, "0")}`;

  // Credited at the original invoice's rate — a correction never applies a
  // different VAT treatment than the sale it corrects.
  const vatRate = Number(invoice.vatRate);
  const totals = calculateVatTotals(amount, vatRate);

  return tx.creditNote.create({
    data: {
      number,
      invoiceId,
      reason: reason ?? null,
      subtotalExclVat: totals.totalExclVat,
      vatRate,
      vatAmount: totals.vatAmount,
      totalInclVat: totals.totalInclVat,
    },
  });
}
