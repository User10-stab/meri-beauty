import { prisma } from "@/lib/prisma";
import { prepareInvoice } from "@/lib/invoicing";
import { buildStaffCustomer, rentInvoiceInput } from "@/lib/staff-rent-payment";
import { manualSaleInvoiceInput } from "@/lib/invoices/manual-sale-invoice";
import { AWAITED_TRANSFER_INCLUDE, planAwaitedTransferInvoice } from "@/lib/payments/awaited-transfer";

/**
 * The invoice a pending row of the Factures page would get (« Émettre la
 * facture » for a rent, « Accepter » otherwise), built without issuing it:
 * same inputs as the issuing paths (the shared
 * *InvoiceInput helpers) and same guards and figures (prepareInvoice), but no
 * number is taken and nothing is written. A row that would not get an
 * invoice — or whose invoice would be refused — says why instead.
 *
 * Not a "use server" module: reached only through the admin-gated route
 * app/api/invoices/preview/route.js.
 */

export const PREVIEW_REASONS = {
  NOT_FOUND: "Cette vente en attente est introuvable ou n'attend plus de paiement.",
  UNKNOWN_KIND: "Aperçu indisponible pour ce type de ligne.",
  ALREADY_INVOICED: "Une facture existe déjà pour ce paiement : ouvrez-la avec « Voir ».",
  PARTIAL: "Le virement attendu ne solde pas la vente : aucune facture ne sera émise à son acceptation (acompte). Elle le sera au paiement du solde.",
  NOT_VAT_REGISTERED: "Client particulier : aucune facture n'est émise, seulement un ticket de caisse.",
  UNKNOWN_SOURCE: "Ce paiement n'est rattaché à aucune vente.",
  SELLER_LEGAL_DATA_INCOMPLETE: "Les informations légales du salon sont incomplètes (Paramètres > Salon) : l'acceptation échouerait. Complétez-les d'abord.",
  B2C_INVOICE_NOT_ALLOWED: "Le numéro de TVA du client n'est pas (ou plus) validé : il sera revérifié à l'acceptation.",
};

const BUYER_INCLUDE = {
  billingProfile: {
    select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
  },
};

async function rentInput(id) {
  const rent = await prisma.staffMonthlyInvoice.findUnique({
    where: { id },
    select: {
      status: true,
      invoiceId: true,
      paymentId: true,
      amount: true,
      lineDescription: true,
      dueDate: true,
      staff: { select: { id: true, vatNumber: true, user: true } },
    },
  });
  if (!rent || !rent.paymentId || !rent.staff?.user) return { reason: "NOT_FOUND" };
  if (rent.status !== "AWAITING_PAYMENT" || rent.invoiceId) return { reason: "ALREADY_INVOICED" };
  const customer = await buildStaffCustomer(rent.staff, rent.staff.user);
  return { input: rentInvoiceInput({ paymentId: rent.paymentId, amount: Number(rent.amount), lineDescription: rent.lineDescription, customer, dueDate: rent.dueDate }) };
}

async function manualSaleInput(id) {
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      source: true,
      status: true,
      totalAmount: true,
      vatRate: true,
      vatTreatment: true,
      taxCountryCode: true,
      taxNote: true,
      invoiceNotes: true,
      items: { select: { productName: true, variantName: true, quantity: true, unitPrice: true }, orderBy: { id: "asc" } },
      user: { include: BUYER_INCLUDE },
      payment: { select: { id: true, invoice: { select: { id: true } } } },
    },
  });
  if (!order || order.source !== "MANUAL" || order.status === "CANCELLED" || !order.payment || !order.user) return { reason: "NOT_FOUND" };
  if (order.payment.invoice) return { reason: "ALREADY_INVOICED" };
  return { input: manualSaleInvoiceInput({ order, buyer: order.user, paymentId: order.payment.id }) };
}

async function transferInput(id) {
  const payment = await prisma.payment.findUnique({ where: { id }, include: AWAITED_TRANSFER_INCLUDE });
  if (!payment || payment.isDeleted || payment.awaitedTransferAmount == null) return { reason: "NOT_FOUND" };
  return planAwaitedTransferInvoice(payment);
}

const INPUT_BUILDERS = { RENT: rentInput, MANUAL_SALE: manualSaleInput, TRANSFER: transferInput };

/**
 * @param {{ kind: "RENT"|"MANUAL_SALE"|"TRANSFER", id: string }} target - the
 *   row's accept target: a StaffMonthlyInvoice id, an Order id, a Payment id.
 * @returns {Promise<{ invoice: object } | { reason: string, message: string }>}
 */
export async function buildPendingInvoicePreview({ kind, id }) {
  const build = INPUT_BUILDERS[kind];
  if (!build || !id) return { reason: "UNKNOWN_KIND", message: PREVIEW_REASONS.UNKNOWN_KIND };

  const planned = await build(id);
  if (planned.reason) return { reason: planned.reason, message: PREVIEW_REASONS[planned.reason] };

  let draft;
  try {
    draft = await prepareInvoice(prisma, planned.input);
  } catch (error) {
    const reason = error?.message ?? "UNKNOWN";
    return { reason, message: error?.userMessage ?? PREVIEW_REASONS[reason] ?? "Cette facture ne pourrait pas être émise." };
  }

  return {
    invoice: {
      ...draft.data,
      // No number exists until the invoice is issued — none is reserved for a preview.
      number: "—",
      issuedAt: new Date(),
      // Keeps the renderer from looking up the (still unpaid) Payment.
      paymentId: null,
      contractId: null,
      lines: draft.lines,
      isPreview: true,
    },
  };
}
