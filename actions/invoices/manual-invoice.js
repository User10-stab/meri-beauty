"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isTillCashOperator } from "@/lib/authorization";
import { manualInvoiceSchema, manualInvoiceSettlementSchema, manualSaleCancelSchema } from "@/lib/validations/manual-invoice";
import { issueInvoice, buildInvoiceCustomer, isSellerLegalDataComplete, assertBuyerLegalDataComplete } from "@/lib/invoicing";
import { allocatePieceNumber, PIECE_SERIES } from "@/lib/cash-book/piece-number";
import { ensureCashSessionOpen } from "@/lib/cash-book/session-lifecycle";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import {
  calculateVatTotals,
  hasReusableVatValidation,
  repriceTtcCataloguePrice,
  resolveGoodsVatPolicy,
  roundMoney,
} from "@/lib/tax-policy";
import { resolveCounterCustomer } from "@/lib/counter/resolve-counter-customer";
import { saveCheckoutVatNumber } from "@/lib/customer-vat";
import { CounterCustomerError } from "@/lib/reservation-errors";
import { isBelgianVatNumber } from "@/lib/peppyrus";
import { AUDIT_ACTIONS } from "@/lib/audit-log";
import { manualSaleInvoiceInput } from "@/lib/invoices/manual-sale-invoice";
import { listAwaitedTransfers } from "@/actions/payments/awaited-transfer";

/**
 * Invoice sales composed at la caisse — free lines, transfers, acomptes,
 * « payer plus tard » and invoice comments (CounterCart). « Générer une
 * facture » on /dashboard/factures opens the same till.
 *
 * An invoice is only ever written by lib/invoicing.js#issueInvoice, anchored
 * to a Payment. So a manual invoice is backed by a real sale: an Order
 * (source MANUAL) with its lines, a Payment, and one Transaction per receipt.
 * That is what puts it in the Livre de recettes, the reports and the cash
 * book (cash only) like every other sale.
 *
 * The invoice follows the site-wide rule for deposits: it is only issued
 * once the sale is FULLY paid — never on an acompte, never unpaid (same as
 * workshop/formation/appointment deposits and counter reservations).
 *   - « Encaisser tout »: the invoice is issued at creation, already paid;
 *   - « Acompte » / « Plus tard »: a pending sale — Order COMPLETED, Payment
 *     PENDING or PARTIALLY_PAID, no invoice, no number consumed. It is listed
 *     on the Factures page; the payment that clears the balance issues the
 *     invoice in the same transaction.
 * Everything issueInvoice would refuse (buyer VAT not VIES-validated, buyer
 * address missing, seller legal data incomplete) is checked at creation
 * anyway, so a pending sale can never turn out to be un-invoiceable after
 * money was taken.
 *
 * The Order is COMPLETED even while unpaid on purpose: the goods/service
 * were handed over (stock leaves at creation), and
 * lib/orders/expire-stale-orders.js cancels orders left in PENDING_PAYMENT.
 * Whether it is paid lives on Payment.status alone.
 *
 * Composed at la caisse (CounterCart, whenever a sale uses a free line, a
 * transfer, an acompte, « payer plus tard » or an invoice comment), so open
 * to the same people as the till's own money: the till cash operators — the
 * admins and Marie (isTillCashOperator). The payee is always the salon
 * (Payment.payeeStaffId null): an independent's sale is never invoiced under
 * the salon's VAT number.
 */

const MANUAL_ORDER_NOTE = "Vente manuelle — saisie depuis le back-office (Factures)";

async function requireManualSaleOperator() {
  const session = await auth();
  if (!session?.user || !isTillCashOperator(session.user)) return { error: "Non autorisé." };
  return { session };
}

function revalidateManualInvoiceViews() {
  revalidatePath("/dashboard/factures");
  revalidatePath("/dashboard/boutique/point-of-sale");
  revalidatePath("/dashboard/livre-de-recettes");
  revalidatePath("/dashboard/operations");
  revalidateCaisseRoutes();
}

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

/** Exactly what the Factures page and DocumentDeliveryDialog need — nothing more. */
function serializeIssuedInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.number,
    customerName: invoice.customerName,
    customerLegalName: invoice.customerLegalName,
    customerEmail: invoice.customerEmail,
    customerType: invoice.customerType,
    customerVatNumber: invoice.customerVatNumber,
    totalInclVat: Number(invoice.totalInclVat),
    emailSentAt: invoice.emailSentAt ?? null,
    peppyrusSentAt: invoice.peppyrusSentAt ?? null,
    peppolApplicable: invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber),
  };
}

function serializePendingSale({ order, buyer, totalAmount, paidAmount, remainingAmount }) {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: buyer.billingProfile?.companyLegalName || buyer.fullName,
    totalAmount: Number(totalAmount),
    paidAmount: Number(paidAmount),
    remainingAmount: Number(remainingAmount),
  };
}

const OPEN_PAYMENT_STATUSES = ["PENDING", "PARTIALLY_PAID"];

const BUYER_INCLUDE = {
  billingProfile: {
    select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
  },
};

/**
 * issueInvoice's own buyer guards, run without numbering anything. Called at
 * creation for every mode, so a sale whose invoice would later be refused is
 * refused before any money is recorded.
 */
function assertInvoiceable(buyer) {
  if (!hasReusableVatValidation(buyer, buyer.vatNumber)) throw new Error("B2C_INVOICE_NOT_ALLOWED");
  assertBuyerLegalDataComplete(buildInvoiceCustomer(buyer));
}

/** Issues the invoice of a fully-paid manual sale (see manualSaleInvoiceInput). */
function issueManualInvoice(tx, { order, buyer, paymentId }) {
  return issueInvoice(tx, manualSaleInvoiceInput({ order, buyer, paymentId }));
}

/**
 * Records money received on a manual sale's Payment, inside the caller's
 * transaction — the whole balance, or an acompte (`amount` below the
 * balance). One Transaction per receipt: DEPOSIT while a balance remains,
 * FINAL_PAYMENT for the one that clears it. Payment.paidAt is only set once
 * fully paid.
 *
 * The claim is conditional on the exact paidAmount just read: two tabs
 * recording money on the same sale cannot both succeed, so the balance can
 * never be over-collected — nor its invoice issued twice.
 *
 * A CASH receipt by an admin is a till operation — it belongs to the open
 * cash session and gets its cash-book line number, exactly like a counter
 * sale. Card and transfer never touch the drawer.
 */
async function settleInTx(tx, { paymentId, amount = null, method, cashReceived, reference }) {
  const current = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { status: true, totalAmount: true, paidAmount: true },
  });
  if (!current || !OPEN_PAYMENT_STATUSES.includes(current.status)) throw new Error("MANUAL_INVOICE_ALREADY_SETTLED");

  const totalAmount = Number(current.totalAmount);
  const alreadyPaid = Number(current.paidAmount);
  const balance = roundMoney(totalAmount - alreadyPaid);
  const received = amount == null ? balance : roundMoney(amount);
  if (!(received > 0)) throw new Error("MANUAL_INVOICE_AMOUNT_INVALID");
  if (received > balance + 0.001) throw new Error("MANUAL_INVOICE_AMOUNT_EXCEEDS_BALANCE");

  const paidAfter = roundMoney(alreadyPaid + received);
  const remainingAfter = roundMoney(totalAmount - paidAfter);
  const fullyPaid = remainingAfter <= 0.001;
  const paidAt = new Date();

  const claim = await tx.payment.updateMany({
    where: { id: paymentId, status: { in: OPEN_PAYMENT_STATUSES }, paidAmount: current.paidAmount },
    data: {
      status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
      paidAmount: paidAfter,
      remainingAmount: fullyPaid ? 0 : remainingAfter,
      ...(fullyPaid ? { paidAt } : {}),
    },
  });
  if (claim.count === 0) throw new Error("MANUAL_INVOICE_ALREADY_SETTLED");

  let cashSessionId = null;
  let pieceNumber = null;
  let changeGiven = null;
  if (method === "CASH") {
    if (cashReceived < received) throw new Error("MANUAL_INVOICE_CASH_INSUFFICIENT");
    changeGiven = roundMoney(cashReceived - received);
    const openCashSession = await tx.cashSession.findFirst({
      where: { closedAt: null },
      orderBy: { openedAt: "desc" },
      select: { id: true },
    });
    if (!openCashSession) throw new Error("MANUAL_INVOICE_CASH_SESSION_CLOSED");
    cashSessionId = openCashSession.id;
    pieceNumber = await allocatePieceNumber(tx, PIECE_SERIES.ORDER);
  }

  const transaction = await tx.transaction.create({
    data: {
      paymentId,
      amount: received,
      method,
      transactionType: fullyPaid ? "FINAL_PAYMENT" : "DEPOSIT",
      paidAt,
      // Terminal ticket for a card, bank reference for a transfer — the only
      // record tying this sale to money actually received.
      manualReference: method === "CASH" ? null : reference?.trim() || null,
      cashReceived: method === "CASH" ? cashReceived : null,
      changeGiven,
      cashSessionId,
      pieceNumber,
    },
    select: { id: true, pieceNumber: true },
  });

  return { ...transaction, received, paidAfter, remainingAfter: fullyPaid ? 0 : remainingAfter, fullyPaid };
}

/** Opens the till automatically when possible, like every other cash sale. */
async function cashSessionGate(method) {
  if (method !== "CASH") return null;
  const open = await ensureCashSessionOpen(prisma);
  if (open) return null;
  return {
    success: false,
    message: "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'encaisser en espèces.",
    requiresCashSession: true,
  };
}

function mapError(error, context) {
  const message = error?.message ?? "";
  if (error instanceof CounterCustomerError) return error.message;
  if (message === "SELLER_LEGAL_DATA_INCOMPLETE") {
    return "Les informations légales du salon (raison sociale, TVA, adresse) sont incomplètes. Complétez-les dans les paramètres avant d'émettre une facture.";
  }
  if (message === "BUYER_LEGAL_DATA_INCOMPLETE") return error.userMessage ?? "Nom ou adresse du client manquant.";
  if (message === "B2C_INVOICE_NOT_ALLOWED") {
    return "Le numéro de TVA du client n'est pas validé : une facture ne peut être émise qu'à un client assujetti.";
  }
  if (message === "MANUAL_INVOICE_PRODUCT_UNAVAILABLE") return "Un produit de la vente n'est plus disponible.";
  if (message.startsWith("MANUAL_INVOICE_STOCK_UNAVAILABLE:")) {
    return `Stock insuffisant pour « ${message.split(":").slice(1).join(":")} ».`;
  }
  if (message === "MANUAL_INVOICE_CASH_INSUFFICIENT") return "Le montant reçu en espèces est inférieur à la somme encaissée.";
  if (message === "MANUAL_INVOICE_CASH_SESSION_CLOSED") {
    return "La caisse a été fermée entre-temps. Rouvrez-la avant d'encaisser en espèces.";
  }
  if (message === "MANUAL_INVOICE_ALREADY_SETTLED") {
    return "Cette vente vient d'être encaissée ou modifiée par ailleurs. Rechargez la page pour voir le solde à jour.";
  }
  if (message === "MANUAL_INVOICE_AMOUNT_EXCEEDS_BALANCE") return "Le montant dépasse le solde restant dû.";
  if (message === "MANUAL_INVOICE_AMOUNT_INVALID") return "Le montant encaissé doit être supérieur à 0.";
  if (message === "MANUAL_INVOICE_DEPOSIT_NOT_PARTIAL") {
    return "Un acompte doit être inférieur au total — pour tout encaisser, choisissez « Encaisser tout ».";
  }
  if (message === "MANUAL_SALE_NOT_CANCELLABLE") {
    return "Cette vente ne peut plus être annulée ici : elle a été encaissée, facturée ou annulée entre-temps. Rechargez la page.";
  }
  if (error?.code === "P2002") {
    const target = String(error.meta?.target ?? "");
    if (target.includes("email")) return "Cette adresse e-mail est déjà utilisée par un autre compte.";
    if (target.includes("phone")) return "Ce numéro de téléphone est déjà utilisé par un autre compte.";
  }
  if (error?.code === "P2028") return "L'opération a pris trop de temps et a été annulée. Réessayez.";
  console.error(`[${context}]`, error);
  return "L'opération a échoué. Réessayez.";
}

/**
 * Records a manual sale. Paid in full: its invoice is issued at once.
 * Acompte or later: a pending sale, invoiced by the payment that clears it.
 *
 * Idempotent on `attemptKey` (stored in Order.posAttemptKey, @unique): a
 * double click or a network retry returns what the first attempt produced
 * instead of recording the sale — or burning an invoice number — twice.
 *
 * @returns {{ success: true, data: { invoice: object|null, sale: object } }}
 *   `invoice` is set only when the sale was paid in full.
 */
export async function createManualInvoice(input) {
  const guard = await requireManualSaleOperator();
  if (guard.error) return { success: false, message: guard.error };
  const { session } = guard;

  const parsed = manualInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Données de facture invalides." };
  }
  const { attemptKey, customer: requestedCustomer, lines, notes, dueDate, settlement } = parsed.data;
  const paidInFull = settlement.mode === "NOW";

  const replay = await findReplay(attemptKey, session.user.id);
  if (replay) return replay;

  if (!(await isSellerLegalDataComplete())) {
    return { success: false, message: mapError(new Error("SELLER_LEGAL_DATA_INCOMPLETE"), "createManualInvoice") };
  }

  if (settlement.mode !== "LATER") {
    const gate = await cashSessionGate(settlement.method);
    if (gate) return gate;
  }

  let result;
  try {
    // Resolved before the transaction: it may call VIES (up to ~8 s), which
    // must not hold a database transaction open. A customer created or a VAT
    // number validated here survives a later failure — harmless, and exactly
    // what a retry needs.
    const customer = await resolveCounterCustomer(prisma, {
      userId: requestedCustomer.id || undefined,
      fullName: requestedCustomer.fullName,
      email: requestedCustomer.email,
      // resolveOrCreateCustomer calls phone.trim() unguarded.
      phone: requestedCustomer.phone ?? "",
      vatNumber: requestedCustomer.vatNumber,
      addressLine1: requestedCustomer.addressLine1,
      addressLine2: requestedCustomer.addressLine2,
      addressCity: requestedCustomer.addressCity,
      addressPostalCode: requestedCustomer.addressPostalCode,
      addressCountry: requestedCustomer.addressCountry || "BE",
    });

    result = await prisma.$transaction(
      async (tx) => {
        const buyer = await tx.user.findUnique({ where: { id: customer.id }, include: BUYER_INCLUDE });

        // Whatever the mode: a sale recorded here must be invoiceable.
        assertInvoiceable(buyer);

        const vatPolicy = resolveGoodsVatPolicy({ customer: buyer });

        // Catalogue lines: row-locked, re-read, never priced by the client.
        const requestedByVariant = new Map();
        for (const line of lines) {
          if (line.type !== "PRODUCT") continue;
          requestedByVariant.set(line.variantId, (requestedByVariant.get(line.variantId) ?? 0) + line.quantity);
        }
        const variants = new Map();
        for (const [variantId, quantity] of requestedByVariant) {
          await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
          const variant = await tx.productVariant.findFirst({
            where: { id: variantId, isActive: true, isDeleted: false, product: { isDeleted: false, status: "ACTIVE" } },
            select: { id: true, name: true, sku: true, price: true, stockQuantity: true, reservedQuantity: true, product: { select: { name: true } } },
          });
          if (!variant) throw new Error("MANUAL_INVOICE_PRODUCT_UNAVAILABLE");
          if (quantity > variant.stockQuantity - variant.reservedQuantity) {
            throw new Error(`MANUAL_INVOICE_STOCK_UNAVAILABLE:${variant.product.name}`);
          }
          variants.set(variantId, variant);
        }

        // One priced line per input line, in the order the admin composed
        // them. Catalogue prices are stored TTC at 21 % and re-priced to the
        // buyer's rate (0 % for a VIES-validated foreign-EU company); a free
        // line is charged exactly as typed.
        const priced = lines.map((line) => {
          if (line.type === "FREE") return { ...line, variant: null, unitPrice: line.unitPrice };
          const variant = variants.get(line.variantId);
          return { ...line, variant, unitPrice: repriceTtcCataloguePrice(variant.price, vatPolicy.vatRate) };
        });
        const total = roundMoney(priced.reduce((sum, line) => sum + roundMoney(line.unitPrice * line.quantity), 0));
        const taxTotals = calculateVatTotals(total, vatPolicy.vatRate);

        // An acompte has to leave a balance: the whole amount is « Encaisser
        // tout », and the admin must be told rather than have it silently
        // recorded as a full payment.
        if (settlement.mode === "DEPOSIT" && settlement.amount >= total) {
          throw new Error("MANUAL_INVOICE_DEPOSIT_NOT_PARTIAL");
        }
        const awaitedTransferAmount =
          settlement.mode === "LATER" && settlement.awaitedTransferAmount ? Math.min(settlement.awaitedTransferAmount, total) : null;

        const now = new Date();
        const order = await tx.order.create({
          data: {
            userId: buyer.id,
            fulfilmentMode: "PICKUP_ON_SITE",
            status: "COMPLETED",
            source: "MANUAL",
            createdByStaffId: session.user.id,
            posAttemptKey: attemptKey,
            subtotal: total,
            shippingCost: 0,
            totalAmount: total,
            taxCountryCode: vatPolicy.taxCountryCode,
            vatTreatment: vatPolicy.vatTreatment,
            vatRate: vatPolicy.vatRate,
            totalExclVat: taxTotals.totalExclVat,
            totalVat: taxTotals.vatAmount,
            customerVatNumber: buyer.vatNumber ?? null,
            taxNote: vatPolicy.taxNote,
            invoiceRequested: true,
            pickedUpAt: now,
            pickedUpByStaffId: session.user.id,
            notes: MANUAL_ORDER_NOTE,
            // Kept until the invoice exists — see model Order.
            invoiceNotes: notes || null,
            // Noon rather than midnight, so the date never slips a day
            // whichever way the timestamp is later formatted. Meaningless
            // once paid in full.
            paymentDueDate: !paidInFull && dueDate ? new Date(`${dueDate}T12:00:00`) : null,
            items: {
              create: priced.map((line) => ({
                variantId: line.variant?.id ?? null,
                productName: line.variant ? line.variant.product.name : line.description,
                variantName: line.variant?.name ?? null,
                sku: line.variant?.sku ?? null,
                unitPrice: line.unitPrice,
                quantity: line.quantity,
              })),
            },
          },
          select: {
            id: true,
            orderNumber: true,
            totalAmount: true,
            vatRate: true,
            vatTreatment: true,
            taxCountryCode: true,
            taxNote: true,
            invoiceNotes: true,
          },
        });
        // Paid in full, the invoice is issued from the lines as composed.
        order.items = priced.map((line) => ({
          productName: line.variant ? line.variant.product.name : line.description,
          variantName: line.variant?.name ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }));

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            totalAmount: total,
            paidAmount: 0,
            remainingAmount: total,
            // The acompte agreed at creation — informational, like on
            // bookings; what was actually received is in the Transaction rows.
            depositAmount: settlement.mode === "DEPOSIT" ? settlement.amount : 0,
            // Announced by transfer, not received: see lib/payments/awaited-transfer.js.
            awaitedTransferAmount,
            paymentType: settlement.mode === "DEPOSIT" ? "DEPOSIT" : "ON_SITE",
            status: "PENDING",
          },
          select: { id: true },
        });

        // The goods leave the stock now, whether or not they are paid yet.
        for (const [variantId, quantity] of requestedByVariant) {
          const updated = await tx.productVariant.update({
            where: { id: variantId },
            data: { stockQuantity: { decrement: quantity } },
            select: { stockQuantity: true },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId,
              type: "SALE",
              quantity: -quantity,
              previousStock: updated.stockQuantity + quantity,
              newStock: updated.stockQuantity,
              reason: `Vente manuelle n°${order.orderNumber}`,
              createdById: session.user.id,
            },
          });
        }

        let receipt = null;
        if (settlement.mode !== "LATER") {
          receipt = await settleInTx(tx, {
            paymentId: payment.id,
            // NOW collects the whole balance; DEPOSIT only the acompte.
            amount: settlement.mode === "DEPOSIT" ? settlement.amount : null,
            method: settlement.method,
            cashReceived: settlement.cashReceived ?? 0,
            reference: settlement.reference,
          });
        }

        // Invoiced only once fully paid — here, only « Encaisser tout ».
        const invoice = receipt?.fullyPaid ? await issueManualInvoice(tx, { order, buyer, paymentId: payment.id }) : null;

        const paidAmount = receipt?.paidAfter ?? 0;
        const remainingAmount = receipt ? receipt.remainingAfter : total;
        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            actorRole: session.user.role,
            action: invoice ? AUDIT_ACTIONS.INVOICE_MANUAL_CREATED : AUDIT_ACTIONS.MANUAL_SALE_CREATED,
            entityType: invoice ? "Invoice" : "Order",
            entityId: invoice ? invoice.id : order.id,
            after: {
              ...(invoice ? { number: invoice.number } : {}),
              totalInclVat: total,
              vatRate: vatPolicy.vatRate,
              settlement: settlement.mode,
              ...(awaitedTransferAmount ? { awaitedTransferAmount } : {}),
              paidAmount,
              remainingAmount,
              method: settlement.mode === "LATER" ? null : settlement.method,
            },
            metadata: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              paymentId: payment.id,
              customerId: buyer.id,
              lineCount: lines.length,
              attemptKey,
              ...(receipt?.pieceNumber ? { pieceNumber: receipt.pieceNumber } : {}),
            },
          },
        });

        return {
          invoice,
          sale: serializePendingSale({ order, buyer, totalAmount: total, paidAmount, remainingAmount }),
        };
      },
      // Row locks, invoice numbering and a per-line stock/audit loop are all
      // sequential round trips — same headroom as the till (P2028 otherwise).
      { timeout: 20000, maxWait: 10000 }
    );
  } catch (error) {
    // Two submits raced past findReplay: the loser hits the unique attempt
    // key. The winner's sale is the answer.
    if (error?.code === "P2002" && String(error.meta?.target ?? "").includes("posAttemptKey")) {
      const raced = await findReplay(attemptKey, session.user.id);
      if (raced) return raced;
    }
    return { success: false, message: mapError(error, "createManualInvoice") };
  }

  revalidateManualInvoiceViews();
  return {
    success: true,
    data: { invoice: result.invoice ? serializeIssuedInvoice(result.invoice) : null, sale: result.sale },
  };
}

async function findReplay(attemptKey, actorId) {
  const prior = await prisma.order.findUnique({
    where: { posAttemptKey: attemptKey },
    select: {
      id: true,
      orderNumber: true,
      source: true,
      createdByStaffId: true,
      user: { select: { fullName: true, billingProfile: { select: { companyLegalName: true } } } },
      payment: { select: { totalAmount: true, paidAmount: true, remainingAmount: true, invoice: true } },
    },
  });
  if (!prior) return null;
  if (prior.source !== "MANUAL" || prior.createdByStaffId !== actorId || !prior.payment) {
    return { success: false, message: "Cette tentative a déjà été utilisée. Rechargez la page." };
  }
  return {
    success: true,
    data: {
      invoice: prior.payment.invoice ? serializeIssuedInvoice(prior.payment.invoice) : null,
      sale: serializePendingSale({ order: prior, buyer: prior.user, ...prior.payment }),
      alreadyProcessed: true,
    },
  };
}

function findPendingManualOrders() {
  return prisma.order.findMany({
    where: { source: "MANUAL", status: "COMPLETED", payment: { is: { status: { in: OPEN_PAYMENT_STATUSES } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      paymentDueDate: true,
      customerVatNumber: true,
      user: { select: { fullName: true, email: true, billingProfile: { select: { companyLegalName: true } } } },
      items: { select: { productName: true, variantName: true, quantity: true }, orderBy: { id: "asc" } },
      payment: {
        select: { totalAmount: true, paidAmount: true, remainingAmount: true, awaitedTransferAmount: true, invoice: { select: { number: true } } },
      },
    },
  });
}

/**
 * The manual sales still waiting for (part of) their money — the
 * « Ventes en attente de paiement » panel, on la caisse and on the Factures
 * page.
 */
export async function listPendingManualSales() {
  const guard = await requireManualSaleOperator();
  if (guard.error) return { success: false, message: guard.error };

  let orders;
  try {
    orders = await findPendingManualOrders();
  } catch (error) {
    // The panel is secondary to the invoice list on the same page: a failure
    // here hides it instead of taking the whole Factures page down.
    console.error("[listPendingManualSales]", error);
    return { success: false, message: "Impossible de charger les ventes en attente de paiement." };
  }

  const manualRows = orders.map((order) => ({
    kind: "MANUAL_SALE",
    orderId: order.id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    paymentDueDate: order.paymentDueDate,
    // A transfer announced but not received yet — « Virement reçu » records it.
    awaitedTransferAmount: order.payment.awaitedTransferAmount == null ? null : Number(order.payment.awaitedTransferAmount),
    customerName: order.user?.fullName ?? "",
    customerLegalName: order.user?.billingProfile?.companyLegalName ?? null,
    customerEmail: order.user?.email ?? null,
    customerVatNumber: order.customerVatNumber,
    summary: order.items.map((item) => `${item.quantity} × ${item.variantName ? `${item.productName} — ${item.variantName}` : item.productName}`).join(", "),
    totalAmount: Number(order.payment.totalAmount),
    paidAmount: Number(order.payment.paidAmount),
    remainingAmount: Number(order.payment.remainingAmount),
    // Only a sale recorded before invoices waited for full payment has one.
    invoiceNumber: order.payment.invoice?.number ?? null,
  }));

  // Bookings, pickup orders and counter séances closed out with « Virement »
  // wait for their money too — one list for all of it (the user's own call).
  const transfers = await listAwaitedTransfers();
  const rows = [...manualRows, ...(transfers.success ? transfers.data.rows : [])];

  return {
    success: true,
    data: {
      rows,
      stats: { count: rows.length, remainingTotal: roundMoney(rows.reduce((sum, row) => sum + row.remainingAmount, 0)) },
    },
  };
}

/**
 * Records money on a pending manual sale — the « Encaisser » button of the
 * pending panel. `amount` defaults to the whole balance; a smaller amount is
 * a further acompte. The payment that clears the balance issues the invoice,
 * in the same transaction: either both happen or neither does.
 */
export async function settleManualInvoice(input) {
  const guard = await requireManualSaleOperator();
  if (guard.error) return { success: false, message: guard.error };
  const { session } = guard;

  const parsed = manualInvoiceSettlementSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Données d'encaissement invalides." };
  }
  const { orderId, amount, method, cashReceived, reference } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      source: true,
      status: true,
      user: { include: BUYER_INCLUDE },
      payment: { select: { id: true, status: true, totalAmount: true, paidAmount: true, invoice: { select: { id: true } } } },
    },
  });
  if (!order || order.source !== "MANUAL" || !order.payment) {
    return { success: false, message: "Seule une vente manuelle peut être encaissée ici." };
  }
  if (order.status === "CANCELLED") return { success: false, message: "Cette vente a été annulée : elle ne peut plus être encaissée." };
  if (!OPEN_PAYMENT_STATUSES.includes(order.payment.status)) {
    return { success: false, message: "Cette vente est déjà entièrement encaissée." };
  }

  const balance = roundMoney(Number(order.payment.totalAmount) - Number(order.payment.paidAmount));
  const clearsBalance = amount == null || amount + 0.001 >= balance;
  const issuesInvoice = clearsBalance && !order.payment.invoice;

  // The invoice about to be issued needs a VIES validation under 90 days
  // (issueInvoice's B2C_INVOICE_NOT_ALLOWED). A pending sale can outlive
  // the one made at creation, so re-check — outside the transaction, as
  // VIES may take seconds. A VIES outage still accepts provisionally.
  if (issuesInvoice && !hasReusableVatValidation(order.user, order.user.vatNumber)) {
    const refreshed = await saveCheckoutVatNumber(prisma, order.user, order.user.vatNumber);
    if (!refreshed.success) {
      return {
        success: false,
        message: `Solde non encaissé : la facture ne peut pas être émise, le numéro de TVA du client n'est plus validé (${refreshed.message})`,
      };
    }
  }

  const gate = await cashSessionGate(method);
  if (gate) return gate;

  let outcome;
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const recorded = await settleInTx(tx, {
          paymentId: order.payment.id,
          amount: amount ?? null,
          method,
          cashReceived: cashReceived ?? 0,
          reference,
        });
        // Whatever was announced, this is what actually arrived: the sale no
        // longer waits on that transfer.
        await tx.payment.update({ where: { id: order.payment.id }, data: { awaitedTransferAmount: null } });

        let invoice = null;
        if (recorded.fullyPaid && !order.payment.invoice) {
          const [sale, buyer] = await Promise.all([
            tx.order.findUnique({
              where: { id: order.id },
              select: {
                totalAmount: true,
                vatRate: true,
                vatTreatment: true,
                taxCountryCode: true,
                taxNote: true,
                invoiceNotes: true,
                items: { select: { productName: true, variantName: true, quantity: true, unitPrice: true }, orderBy: { id: "asc" } },
              },
            }),
            tx.user.findUnique({ where: { id: order.user.id }, include: BUYER_INCLUDE }),
          ]);
          invoice = await issueManualInvoice(tx, { order: sale, buyer, paymentId: order.payment.id });
        }

        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            actorRole: session.user.role,
            action: invoice ? AUDIT_ACTIONS.INVOICE_MANUAL_SETTLED : AUDIT_ACTIONS.MANUAL_SALE_PAYMENT_RECORDED,
            entityType: invoice ? "Invoice" : "Order",
            entityId: invoice ? invoice.id : order.id,
            before: { paymentStatus: order.payment.status, paidAmount: Number(order.payment.paidAmount) },
            after: {
              paymentStatus: recorded.fullyPaid ? "PAID" : "PARTIALLY_PAID",
              paidAmount: recorded.paidAfter,
              method,
              amount: recorded.received,
              ...(invoice ? { number: invoice.number } : {}),
            },
            metadata: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              paymentId: order.payment.id,
              ...(recorded.pieceNumber ? { pieceNumber: recorded.pieceNumber } : {}),
            },
          },
        });
        return { recorded, invoice };
      },
      { timeout: 20000, maxWait: 10000 }
    );
  } catch (error) {
    return { success: false, message: mapError(error, "settleManualInvoice") };
  }

  revalidateManualInvoiceViews();
  const { recorded, invoice } = outcome;
  return {
    success: true,
    message: invoice
      ? `Vente n°${order.orderNumber} soldée — facture ${invoice.number} émise.`
      : recorded.fullyPaid
      ? `Vente n°${order.orderNumber} entièrement encaissée.`
      : `Acompte de ${euro(recorded.received)} enregistré sur la vente n°${order.orderNumber} — reste ${euro(recorded.remainingAfter)} à encaisser.`,
    data: {
      fullyPaid: recorded.fullyPaid,
      paidAmount: recorded.paidAfter,
      remainingAmount: recorded.remainingAfter,
      invoice: invoice ? serializeIssuedInvoice(invoice) : null,
    },
  };
}

/**
 * Cancels a pending manual sale nothing has been collected on: the order is
 * cancelled and its goods go back into stock. No invoice exists, so there is
 * nothing to credit. Once money was taken, the acompte has to be refunded
 * and this path refuses.
 */
export async function cancelManualSale(input) {
  const guard = await requireManualSaleOperator();
  if (guard.error) return { success: false, message: guard.error };
  const { session } = guard;

  const parsed = manualSaleCancelSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Annulation invalide." };
  }
  const { orderId, reason } = parsed.data;

  let order;
  try {
    order = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        // The claim carries every condition: still a pending manual sale,
        // nothing received, no invoice. A receipt recorded in another tab a
        // moment earlier makes it match nothing.
        const claim = await tx.order.updateMany({
          where: {
            id: orderId,
            source: "MANUAL",
            status: "COMPLETED",
            payment: { is: { status: "PENDING", paidAmount: 0, invoice: { is: null } } },
          },
          data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason, stockReleasedAt: now },
        });
        if (claim.count === 0) throw new Error("MANUAL_SALE_NOT_CANCELLABLE");

        const cancelled = await tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, orderNumber: true, totalAmount: true, items: { select: { variantId: true, quantity: true } } },
        });
        for (const item of cancelled.items) {
          // Free lines carry no stock.
          if (!item.variantId) continue;
          const updated = await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: { increment: item.quantity } },
            select: { stockQuantity: true },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: "RETURN",
              quantity: item.quantity,
              previousStock: updated.stockQuantity - item.quantity,
              newStock: updated.stockQuantity,
              reason: `Annulation vente manuelle n°${cancelled.orderNumber}`,
              createdById: session.user.id,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: session.user.id,
            actorRole: session.user.role,
            action: AUDIT_ACTIONS.MANUAL_SALE_CANCELLED,
            entityType: "Order",
            entityId: cancelled.id,
            before: { status: "COMPLETED" },
            after: { status: "CANCELLED", reason },
            metadata: { orderNumber: cancelled.orderNumber, totalAmount: Number(cancelled.totalAmount) },
          },
        });
        return cancelled;
      },
      { timeout: 20000, maxWait: 10000 }
    );
  } catch (error) {
    return { success: false, message: mapError(error, "cancelManualSale") };
  }

  revalidateManualInvoiceViews();
  return { success: true, message: `Vente n°${order.orderNumber} annulée — les articles sont remis en stock.` };
}
