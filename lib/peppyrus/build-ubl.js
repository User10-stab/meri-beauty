/**
 * Builds PEPPOL BIS Billing 3.0 UBL XML for invoices/credit notes, using
 * @pixeldrive/peppol-toolkit. Peppyrus (lib/peppyrus.js) is a bare
 * transport — it never builds this XML itself, so this module closes that
 * gap that Billit used to close on its own side.
 *
 * Both builders are pure functions (no DB/network access) so the caller
 * resolves `salon` and `buyerParticipantId` beforehand, and so VAT-mapping/
 * fallback logic here stays unit-testable in isolation.
 */

import { PeppolToolkit } from "@pixeldrive/peppol-toolkit";
import { BELGIUM_VAT_RATE, REVERSE_CHARGE_NOTE, roundMoney } from "@/lib/tax-policy";
import { parsePeppolIdentifier } from "@/lib/peppyrus";
import { normalizeVatNumber } from "@/lib/vat-validation";
import { creditNoteLines as deriveCreditNoteLines } from "@/lib/credit-notes/credit-note-lines";

// These sales are always already settled (issueInvoice runs from inside the
// payment-settlement transaction — see lib/invoicing.js) — dueDate is null
// for every source except staff-contract rentals, so BR-CO-25 (a positive
// amount due needs either a due date or payment terms) needs this fallback
// on every other document.
const PAID_AT_ISSUANCE_NOTE = "Facture acquittée — montant déjà réglé au moment de l'émission.";

// ICD (International Code Designator) for the Belgian enterprise number
// (KBO/BCE), used on PartyLegalEntity/CompanyID. Distinct from the EAS
// scheme (9925) used on EndpointID/PartyTaxScheme — confirmed via
// PeppolToolkit.ICDCodes / getEASFromTaxId.
const BE_ENTERPRISE_NUMBER_ICD = "0208";

function netOfGross(gross, vatRatePercent) {
  const divisor = 1 + Number(vatRatePercent) / 100;
  return Number(gross) / divisor;
}

/**
 * InvoiceLine.unitPriceExclVat/lineTotalExclVat default to Decimal(0), not
 * null, for pre-migration rows — a naive `??` fallback (as
 * lib/pdf/theme.jsx's LineItemsTable uses) never triggers on a stored 0. A
 * 0,00 unit price submitted to Peppyrus fails EN16931 validation loudly
 * (GET /message/{id}/report), unlike the PDF path which has no validator to
 * catch it — so this checks magnitude, not nullishness.
 */
function lineNetUnitPrice(line, vatRatePercent) {
  const stored = Number(line.unitPriceExclVat);
  return stored > 0 ? stored : netOfGross(Number(line.unitPrice), vatRatePercent);
}

function lineNetTotal(line, vatRatePercent) {
  const stored = Number(line.lineTotalExclVat);
  return stored > 0 ? stored : netOfGross(Number(line.lineTotal), vatRatePercent);
}

/**
 * v1 scope is Belgian B2B only (same gate as the old Billit integration —
 * see actions/invoices/send-invoice-peppyrus.js), so in practice only
 * DOMESTIC is ever reached. EU_REVERSE_CHARGE is mapped for correctness/
 * future-proofing; EU_DISTANCE_SALE/EXPORT throw rather than silently
 * mis-map, since the send action should never let them reach this far.
 */
function resolveTaxCategory(vatTreatment) {
  switch (vatTreatment) {
    case "DOMESTIC":
      return { categoryCode: "S", percent: BELGIUM_VAT_RATE };
    case "EU_REVERSE_CHARGE":
      return { categoryCode: "AE", percent: 0, exemptionReason: REVERSE_CHARGE_NOTE, exemptionReasonCode: "VATEX-EU-AE" };
    default:
      throw new Error(`Traitement TVA "${vatTreatment}" non pris en charge pour l'envoi Peppyrus (v1 = Belgique B2B uniquement).`);
  }
}

// Neither Salon.vatNumber/companyRegistrationNo nor
// BillingProfile.companyRegistrationNo are normalized on save (the settings
// form's own placeholder shows the human convention "0751.854.027", and the
// seed/migration data was written the same dotted way) — stripping only a
// leading "BE" left those separators in place, which is invalid for both the
// EAS endpoint ID and the enterprise-number CompanyID
// (PEPPOL-COMMON-R043: "Belgian enterprise number MUST be stated in the
// correct format" is exactly this — dots/spaces where only digits belong).
function digitsOnly(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

function buildSellerParty(salon) {
  if (!salon?.vatNumber) throw new Error("Salon.vatNumber manquant — impossible de générer un document Peppol.");
  if (!salon.legalName) throw new Error("Salon.legalName manquant — impossible de générer un document Peppol.");
  const eas = PeppolToolkit.getEASFromTaxId(salon.vatNumber);
  const regNo = digitsOnly(salon.companyRegistrationNo || salon.vatNumber);
  const cleanVat = normalizeVatNumber(salon.vatNumber);
  return {
    endPoint: { scheme: eas, id: digitsOnly(salon.vatNumber) },
    legalEntity: {
      registrationName: salon.legalName,
      companyId: { id: regNo, schemeID: BE_ENTERPRISE_NUMBER_ICD },
    },
    name: salon.legalName,
    address: {
      ...(salon.addressLine1 ? { streetName: salon.addressLine1 } : {}),
      ...(salon.addressLine2 ? { additionalStreetName: salon.addressLine2 } : {}),
      ...(salon.city ? { cityName: salon.city } : {}),
      ...(salon.postalCode ? { postalZone: salon.postalCode } : {}),
      country: salon.countryCode || "BE",
    },
    taxSchemes: [{ companyId: cleanVat, schemeID: "VAT" }],
    identification: [{ id: cleanVat }],
  };
}

function buildBuyerParty(invoice, buyerParticipantId) {
  const vat = invoice.customerVatNumber;
  if (!vat) throw new Error("Le client n'a pas de numéro de TVA — impossible de générer un document Peppol.");
  const parsedRecipient = buyerParticipantId ? parsePeppolIdentifier(buyerParticipantId) : null;
  const eas = parsedRecipient?.schemeID || PeppolToolkit.getEASFromTaxId(vat);
  const endpointId = parsedRecipient?.value || digitsOnly(vat);
  const name = invoice.customerLegalName || invoice.customerName;
  const cleanVat = normalizeVatNumber(vat);
  return {
    endPoint: { scheme: eas, id: endpointId },
    legalEntity: {
      registrationName: name,
      companyId: { id: digitsOnly(invoice.customerRegistrationNo || vat), schemeID: BE_ENTERPRISE_NUMBER_ICD },
    },
    name,
    // Invoice.customerAddress is a single freeform string — no structured
    // street/city/postal split exists on this model. Same limitation the
    // Billit integration had (it sent this exact same string as `Street`).
    // Peppyrus's own EN16931 report (GET /message/{id}/report) is the real
    // check for whether this is good enough — see the verification plan.
    address: {
      ...(invoice.customerAddress ? { streetName: invoice.customerAddress } : {}),
      country: invoice.taxCountryCode || "BE",
    },
    taxSchemes: [{ companyId: cleanVat, schemeID: "VAT" }],
    identification: [{ id: cleanVat }],
  };
}

function buildTaxTotal({ taxableAmount, taxAmount, taxCategory, currency = "EUR" }) {
  return [
    {
      taxAmountCurrency: currency,
      taxAmount: roundMoney(taxAmount),
      subTotals: [
        {
          taxableAmount: roundMoney(taxableAmount),
          taxAmount: roundMoney(taxAmount),
          taxCategory: {
            categoryCode: taxCategory.categoryCode,
            percent: taxCategory.percent,
            ...(taxCategory.exemptionReason ? { exemptionReason: taxCategory.exemptionReason } : {}),
            ...(taxCategory.exemptionReasonCode ? { exemptionReasonCode: taxCategory.exemptionReasonCode } : {}),
          },
        },
      ],
    },
  ];
}

/**
 * A self-inconsistent UBL document is worse than not sending at all — this
 * cross-checks totals computed independently from the line items against
 * the app's own stored totals (the actual source of truth for what the
 * customer was charged) and refuses to build the document if they disagree
 * by more than a rounding cent.
 */
function assertTotalsMatch(computed, expected, label) {
  if (Math.abs(computed - expected) > 0.01) {
    throw new Error(
      `Incohérence de calcul TVA lors de la génération UBL (${label}) : calculé=${computed.toFixed(2)}, attendu=${expected.toFixed(2)}. Envoi bloqué.`,
    );
  }
}

/**
 * Builds a PEPPOL BIS Billing 3.0 UBL XML invoice from a Prisma Invoice
 * (with `lines` included).
 */
export function buildInvoiceUbl({ invoice, salon, buyerParticipantId }) {
  const toolkit = new PeppolToolkit();
  const taxCategory = resolveTaxCategory(invoice.vatTreatment);
  const vatRatePercent = Number(invoice.vatRate);

  const invoiceLines = invoice.lines.map((line, index) => ({
    id: String(index + 1),
    invoicedQuantity: Number(line.quantity),
    unitCode: "EA",
    lineExtensionAmount: roundMoney(lineNetTotal(line, vatRatePercent)),
    price: lineNetUnitPrice(line, vatRatePercent),
    name: line.description,
    currency: "EUR",
    taxCategory: { categoryCode: taxCategory.categoryCode, percent: taxCategory.percent },
  }));

  // Derived by subtraction (taxInclusive - taxExclusive), not rate × base —
  // Invoice.vatAmount itself is a subtraction (see calculateVatTotals in
  // lib/tax-policy.js), and the two methods can land a cent apart at the
  // rounding boundary (e.g. a 51.55 HT line at 21% is 10.8255, which rounds
  // up to 10.83 by multiplication but the invoice's own stored total implies
  // 10.82). Matching the invoice's method here is what makes
  // assertTotalsMatch below meaningful instead of spuriously failing.
  const lineExtensionAmount = roundMoney(invoiceLines.reduce((sum, l) => sum + l.lineExtensionAmount, 0));
  const taxInclusiveAmount = roundMoney(Number(invoice.totalInclVat));
  const taxAmount = roundMoney(taxInclusiveAmount - lineExtensionAmount);

  assertTotalsMatch(lineExtensionAmount, Number(invoice.subtotalExclVat), "HT");
  assertTotalsMatch(taxAmount, Number(invoice.vatAmount), "TVA");
  assertTotalsMatch(taxInclusiveAmount, Number(invoice.totalInclVat), "TTC");

  const doc = {
    ID: invoice.number,
    issueDate: invoice.issuedAt.toISOString().slice(0, 10),
    // BR-CO-25: a positive amount due needs a due date OR payment terms.
    // Falls back to a payment-terms note when there's no due date (the
    // normal case — see PAID_AT_ISSUANCE_NOTE above).
    ...(invoice.dueDate
      ? { dueDate: invoice.dueDate.toISOString().slice(0, 10) }
      : { paymentTermsNote: PAID_AT_ISSUANCE_NOTE }),
    invoiceTypeCode: 380,
    documentCurrencyCode: "EUR",
    // PEPPOL-EN16931-R003: a buyer reference or PO reference must be
    // present. Falls back to this invoice's own number when the customer
    // never supplied a PO reference (the common case).
    buyerReference: invoice.purchaseOrderReference || invoice.number,
    seller: buildSellerParty(salon),
    buyer: buildBuyerParty(invoice, buyerParticipantId),
    taxTotal: buildTaxTotal({ taxableAmount: lineExtensionAmount, taxAmount, taxCategory }),
    legalMonetaryTotal: {
      currency: "EUR",
      lineExtensionAmount,
      taxExclusiveAmount: lineExtensionAmount,
      taxInclusiveAmount,
      prepaidAmount: 0,
      payableAmount: taxInclusiveAmount,
    },
    invoiceLines,
  };

  return toolkit.invoiceToPeppolUBL(doc);
}

/**
 * Builds a PEPPOL BIS Billing 3.0 UBL XML credit note. CreditNote has no
 * line table of its own, so its lines come from the corrected invoice (see
 * lib/credit-notes/credit-note-lines.js): every invoiced product/service for
 * a full credit, one descriptive line for a partial one. Should a legacy
 * invoice's stored lines not add up to the credited HT to the cent, it falls
 * back to one line for the whole amount rather than send totals that fail
 * EN16931's line-sum rule.
 */
export function buildCreditNoteUbl({ creditNote, invoice, salon, buyerParticipantId }) {
  const toolkit = new PeppolToolkit();
  const taxCategory = resolveTaxCategory(invoice.vatTreatment);

  const netTotal = roundMoney(Number(creditNote.subtotalExclVat));
  const taxAmount = roundMoney(Number(creditNote.vatAmount));
  const taxInclusiveAmount = roundMoney(Number(creditNote.totalInclVat));

  const toUblLine = (line, index) => ({
    id: String(index + 1),
    invoicedQuantity: line.quantity,
    unitCode: "EA",
    lineExtensionAmount: roundMoney(line.lineTotalExclVat),
    price: line.unitPriceExclVat,
    name: line.description,
    currency: "EUR",
    taxCategory: { categoryCode: taxCategory.categoryCode, percent: taxCategory.percent },
  });

  let creditNoteLines = deriveCreditNoteLines(creditNote, invoice).map(toUblLine);
  const linesSum = roundMoney(creditNoteLines.reduce((sum, l) => sum + l.lineExtensionAmount, 0));
  if (Math.abs(linesSum - netTotal) > 0.005) {
    creditNoteLines = [
      toUblLine({
        description: `Note de crédit relative à la facture ${invoice.number}`,
        quantity: 1,
        unitPriceExclVat: netTotal,
        lineTotalExclVat: netTotal,
      }, 0),
    ];
  }

  const doc = {
    ID: creditNote.number,
    issueDate: creditNote.issuedAt.toISOString().slice(0, 10),
    // See buildInvoiceUbl above for why these two are always present.
    paymentTermsNote: PAID_AT_ISSUANCE_NOTE,
    creditNoteTypeCode: 381,
    documentCurrencyCode: "EUR",
    billingReference: [
      {
        invoiceDocReference: {
          id: invoice.number,
          issueDate: invoice.issuedAt.toISOString().slice(0, 10),
        },
      },
    ],
    buyerReference: invoice.purchaseOrderReference || creditNote.number,
    seller: buildSellerParty(salon),
    buyer: buildBuyerParty(invoice, buyerParticipantId),
    taxTotal: buildTaxTotal({ taxableAmount: netTotal, taxAmount, taxCategory }),
    legalMonetaryTotal: {
      currency: "EUR",
      lineExtensionAmount: netTotal,
      taxExclusiveAmount: netTotal,
      taxInclusiveAmount,
      prepaidAmount: 0,
      payableAmount: taxInclusiveAmount,
    },
    creditNoteLines,
  };

  return toolkit.creditNoteToPeppolUBL(doc);
}
