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

import {
  BELGIUM_VAT_RATE,
  calculateVatTotals,
  hasReusableVatValidation,
  resolveForeignEuVatPolicy,
  roundMoney,
} from "@/lib/tax-policy";
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
  const vatNumber = vatNumberOverride !== undefined ? vatNumberOverride : user.vatNumber;

  // A VIES-validated number is itself proof the buyer is a taxable business
  // — that's what registers a company for VAT in the first place. Requiring
  // a separately-filled BillingProfile.companyLegalName on top of that (as
  // this used to) produced a real contradiction: an EU_REVERSE_CHARGE
  // invoice — a strictly B2B mechanism — labelled customerType B2C, and one
  // that never reached the dashboard's B2B ledger for manual Peppol entry.
  //
  // hasReusableVatValidation re-checks the number actually used on THIS
  // invoice against the one VIES validated, not just "has this user ever
  // validated something" — a stale proof for a since-changed number, or one
  // past the 90-day window, does not count.
  const viesVerified = hasReusableVatValidation(user, vatNumber);

  return {
    fullName: user.fullName,
    email: user.email,
    vatNumber,
    vatValidatedAt: user.vatValidatedAt ?? null,
    address: formatUserAddress(user),
    isCompany: user.isCompany,
    // A manually-typed legal name (BillingProfile, filled once in /mon-compte
    // or by staff) stays authoritative — VIES returns whatever the trader
    // registered with their tax office, not necessarily the trading name a
    // customer wants printed. It is the fallback that turns a VIES-proven
    // company into a real B2B document, never the override.
    legalName: user.billingProfile?.companyLegalName ?? (viesVerified ? user.vatValidationName ?? null : null),
    companyRegistrationNo: user.billingProfile?.companyRegistrationNo ?? null,
    billingContactName: user.billingProfile?.billingContactName ?? null,
    purchaseOrderReference: user.billingProfile?.purchaseOrderReference ?? null,
  };
}

function round2(n) {
  return roundMoney(n);
}

function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

/**
 * Splits VAT-inclusive invoice lines into their net twins.
 *
 * Article 226(8) of directive 2006/112/CE requires the unit price excluding
 * VAT on every line, so it is stored rather than derived at render time by
 * whoever happens to open the PDF.
 *
 * Two different roundings, on purpose:
 *
 * - the unit price keeps 4 decimals so extracting HT from a TTC catalogue
 *   amount such as 25.95 preserves the accurate 21.4463 base.
 * - the line total is money, so it is rounded to the cent — and the cent or
 *   two of residual that leaves against the invoice's own subtotal is pushed
 *   onto the largest line. Without that, a three-line invoice can print
 *   totals that do not add up, which is exactly what an accountant rejects.
 *
 * `subtotalExclVat` is the invoice's authoritative base (back-calculated from
 * the amount actually charged), never the sum of independently rounded lines.
 *
 * @param {{ description: string, quantity: number, unitPrice: number }[]} lines
 * @param {number} vatRate
 * @param {number} subtotalExclVat
 */
export function allocateNetLines(lines, vatRate, subtotalExclVat) {
  const divisor = 1 + Number(vatRate) / 100;

  const net = lines.map((line) => {
    const lineTotal = round2(line.unitPrice * line.quantity);
    return {
      description: line.description,
      quantity: line.quantity,
      unitPrice: round2(line.unitPrice),
      lineTotal,
      unitPriceExclVat: round4(Number(line.unitPrice) / divisor),
      lineTotalExclVat: round2(lineTotal / divisor),
    };
  });

  if (net.length === 0) return net;

  const residual = round2(Number(subtotalExclVat) - net.reduce((sum, l) => sum + l.lineTotalExclVat, 0));
  if (residual === 0) return net;

  // Largest line by absolute value: a one-cent correction is least visible
  // against the biggest figure, and never flips the sign of a small discount
  // line (which is what picking "the last line" could do).
  let target = 0;
  for (let i = 1; i < net.length; i += 1) {
    if (Math.abs(net[i].lineTotal) > Math.abs(net[target].lineTotal)) target = i;
  }
  net[target].lineTotalExclVat = round2(net[target].lineTotalExclVat + residual);

  return net;
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
 * Invoice years are Brussels legal years, not process-local years. Use
 * Intl's explicit timeZone so deploy hosts, tests, and cron workers cannot
 * drift the gapless sequence around midnight UTC.
 */
async function nextSequenceNumber(tx, series) {
  const year = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", year: "numeric" }).format(new Date())
  );
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
 *   paymentId?: string|null,
 *   contractId?: string|null,
 *   source: "ORDER" | "APPOINTMENT" | "WORKSHOP" | "FORMATION" | "STAFF_CONTRACT",
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
 *   dueDate?: Date|null,
 * }} input
 */
/**
 * The buyer's half of the mandatory invoice mentions.
 *
 * Article 226(5) of Directive 2006/112/CE requires the full name AND address
 * of both the supplier and the customer; for a company the "full name" is its
 * registered name, not a contact's. Nothing enforced this before, and
 * PartyRow in lib/pdf/theme.jsx skips an empty value silently — so a customer
 * with no address on file produced an invoice with the address line simply
 * absent, which reads as a complete document and is not one.
 *
 * The symmetric counterpart of the SELLER_LEGAL_DATA_INCOMPLETE check below:
 * refusing to issue is better than issuing something unusable.
 *
 * @throws {Error} BUYER_LEGAL_DATA_INCOMPLETE, carrying `missing` and a
 *   ready-to-display `userMessage` so every call site words it identically.
 */
export function assertBuyerLegalDataComplete(customer) {
  const missing = [];
  if (!customer?.fullName?.toString().trim()) missing.push("le nom");
  if (!customer?.address?.toString().trim()) missing.push("l'adresse de facturation");
  // No separate legal-name check: isB2B below already derives the B2B
  // classification FROM legalName, so a B2B invoice cannot exist without one.
  // `isCompany` with no registered name is deliberately degraded to a B2C
  // document (see the dedicated test) — it makes no B2B claim, so it is not
  // an incomplete document, and refusing it would break a working fallback.

  if (missing.length === 0) return;

  const plural = missing.length > 1;
  const error = new Error("BUYER_LEGAL_DATA_INCOMPLETE");
  error.missing = missing;
  error.userMessage =
    `Facture impossible à émettre : ${missing.join(", ")} ` +
    `${plural ? "sont obligatoires et manquent" : "est obligatoire et manque"} sur la fiche du client. ` +
    `Complétez-la, puis réessayez.`;
  throw error;
}

export async function issueInvoice(tx, {
  paymentId = null,
  contractId = null,
  source,
  totalInclVat,
  customer,
  lines,
  vatRate = BELGIUM_VAT_RATE,
  vatTreatment = "DOMESTIC",
  taxCountryCode = "BE",
  taxNote = null,
  dueDate = null,
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

  // Idempotency: exactly one of paymentId or contractId must be set.
  const hasPayment = Boolean(paymentId);
  const hasContract = Boolean(contractId);
  if (hasPayment === hasContract) {
    throw new Error("INVOICE_REQUIRES_PAYMENT_OR_CONTRACT");
  }

  // Customer sales are ticket-only unless the buyer has a reusable VIES
  // validation for the exact VAT number being invoiced. Callers normally
  // avoid invoking issueInvoice for B2C, but this central guard prevents a
  // future payment or webhook path from consuming an invoice number.
  // Staff contracts are supplier-side documents and follow their own rules.
  if (source !== "STAFF_CONTRACT" && !hasReusableVatValidation(customer, customer?.vatNumber)) {
    throw new Error("B2C_INVOICE_NOT_ALLOWED");
  }

  // Before nextSequenceNumber: a refused invoice must not consume a number
  // from the gapless legal sequence, transaction rollback or not.
  // For STAFF_CONTRACT invoices the buyer's address may not be on file
  // (staff users have only name/email/phone), so we degrade the check to
  // only require a name — the address is still stored if present.
  if (source === "STAFF_CONTRACT") {
    if (!customer?.fullName?.toString().trim()) {
      const err = new Error("BUYER_LEGAL_DATA_INCOMPLETE");
      err.missing = ["le nom"];
      err.userMessage = "Facture impossible à émettre : le nom est obligatoire et manque sur la fiche du client.";
      throw err;
    }
    if (!customer?.email?.toString().trim()) {
      const err = new Error("BUYER_LEGAL_DATA_INCOMPLETE");
      err.missing = ["l'adresse e-mail"];
      err.userMessage = "Facture impossible à émettre : l'adresse e-mail est obligatoire et manque.";
      throw err;
    }
  } else {
    assertBuyerLegalDataComplete(customer);
  }

  // Defense in depth: every invoice applies the same validated foreign-EU
  // customer rule, including older call sites without their own resolver.
  const foreignEuPolicy = resolveForeignEuVatPolicy({ customer });
  if (foreignEuPolicy) {
    vatRate = foreignEuPolicy.vatRate;
    vatTreatment = foreignEuPolicy.vatTreatment;
    taxCountryCode = foreignEuPolicy.taxCountryCode;
    taxNote = foreignEuPolicy.taxNote;
  }

  const { year, seq } = await nextSequenceNumber(tx, "invoice");
  const number = `F-${year}-${String(seq).padStart(6, "0")}`;

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
      paymentId: paymentId ?? undefined,
      contractId: contractId ?? undefined,
      dueDate: dueDate ?? undefined,
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
        create: allocateNetLines(lines, vatRate, totals.totalExclVat),
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
