import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { hasInvoiceableVatIdentity, resolveGoodsVatPolicy, resolveServiceVatPolicy, roundMoney } from "@/lib/tax-policy";
import { allocatePaymentTicketNumber } from "@/lib/tickets/allocate-ticket-number";
import { customerForPayment } from "@/lib/payments/payment-category";

/**
 * « Virement » at the counter: the client leaves without paying.
 *
 * A bank transfer takes days to arrive, so it is never accepted at the till.
 * The visit is closed (the booking is completed, the goods are handed over),
 * but NOTHING is recorded as received: no Transaction, no ticket number and
 * — following the site rule — no invoice. The Payment keeps its status
 * (PENDING, or PARTIALLY_PAID when a deposit was paid online) and carries
 * `awaitedTransferAmount`, the sum expected.
 *
 * It only becomes money when an admin accepts it from « Ventes en attente de
 * paiement » (actions/payments/awaited-transfer.js), which records the
 * TRANSFER and issues the invoice in the same transaction.
 *
 * Used by every counter flow: the booking balance (completeAppointment,
 * lib/reservations/settle-reservation.js), the pickup order
 * (completeOrderPickup), a séance sold at the counter
 * (actions/counter/create-reservation.js) and the retail till's invoice sales
 * (actions/invoices/manual-invoice.js).
 *
 * Not a "use server" module: it writes money and invoices, so it is only
 * reachable through the auth-gated actions that import it.
 */

export const AWAITED_TRANSFER_METHOD = "TRANSFER";

/** Whether this counter settlement is an announced transfer rather than money in hand. */
export function isAwaitedTransfer(method) {
  return method === AWAITED_TRANSFER_METHOD;
}

/**
 * Refused when a transfer is announced on a sale that is not collected at the
 * salon's till — a non-operator settling off-till, or an independent's sale
 * (Payment.payeeStaffId). Both used to fall through to the ordinary
 * collection branch, which writes paidAmount = total: the client left without
 * paying and the system recorded the sale as settled. An independent's
 * transfer was worse still — listAwaitedTransfers filters payeeStaffId: null,
 * so it could never be accepted and the money was unrecoverable.
 *
 * Only formations can belong to an independent animator
 * (resolvePayeeForWorkshopSession is always the salon), plus appointments
 * with an independent practitioner.
 */
export const AWAITED_TRANSFER_OFF_TILL_MESSAGE =
  "Le virement ne peut être annoncé qu'à la caisse du salon. Cette vente est encaissée hors caisse (prestation d'une indépendante) : réglez-la directement avec elle.";

/**
 * Records, inside the caller's transaction, that this payment waits on a
 * transfer of `amount`. Deliberately does not touch paidAmount or status:
 * nothing has been received.
 */
export function markPaymentAwaitingTransfer(tx, { paymentId, amount, totalAmount = null }) {
  return tx.payment.update({
    where: { id: paymentId },
    data: {
      awaitedTransferAmount: roundMoney(amount),
      ...(totalAmount != null ? { totalAmount: roundMoney(totalAmount), remainingAmount: roundMoney(amount) } : {}),
    },
  });
}

/** The relations every awaited-transfer read needs: who owes, and for what. */
export const AWAITED_TRANSFER_INCLUDE = {
  invoice: { select: { id: true, number: true } },
  order: { include: { user: { include: { billingProfile: true } }, items: true } },
  appointment: {
    include: {
      user: { include: { billingProfile: true } },
      staffService: { include: { service: { select: { name: true } } } },
    },
  },
  workshopReservation: {
    include: {
      customer: { include: { billingProfile: true } },
      session: { include: { workshop: { select: { title: true, type: true } } } },
    },
  },
  formationReservation: {
    include: {
      customer: { include: { billingProfile: true } },
      session: { include: { formation: { select: { title: true } } } },
    },
  },
};

/**
 * What the accepted transfer pays for, whichever of the four sources the
 * Payment hangs off: the invoice source, its lines and a label for the
 * screens. Totals come from the Payment — by now they are final (any price
 * adjustment happened when the visit was closed).
 */
export function describeAwaitedTransfer(payment) {
  const total = Number(payment.totalAmount);
  const seatsLabel = (reservation) => {
    const seats = reservation.seatsCount ?? 1;
    return `${seats} place${seats > 1 ? "s" : ""}`;
  };

  if (payment.order) {
    return {
      kind: "ORDER",
      // Payment has no createdAt column, so the date shown beside an awaited
      // transfer comes from whatever it is owed on.
      occurredAt: payment.order.createdAt,
      invoiceSource: "ORDER",
      ticketKind: "ORDER",
      label: `Commande n°${payment.order.orderNumber}`,
      summary: payment.order.items.map((item) => `${item.quantity} × ${item.productName}`).join(", "),
      customer: payment.order.user,
      isGoods: true,
      lines: payment.order.items.map((item) => ({
        description: item.variantName ? `${item.productName} — ${item.variantName}` : item.productName,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    };
  }
  if (payment.appointment) {
    const description = payment.appointment.staffService?.service?.name ?? "Prestation";
    return {
      kind: "APPOINTMENT",
      occurredAt: payment.appointment.startTime,
      invoiceSource: "APPOINTMENT",
      ticketKind: "APPOINTMENT",
      label: "Rendez-vous",
      summary: description,
      customer: payment.appointment.user,
      isGoods: false,
      lines: buildServiceInvoiceLines({ description, totalAmount: total, discountAmount: Number(payment.discountAmount ?? 0) }),
    };
  }
  if (payment.workshopReservation) {
    const title = payment.workshopReservation.session?.workshop?.title ?? "Atelier";
    const description = `${title} (${seatsLabel(payment.workshopReservation)})`;
    return {
      kind: "WORKSHOP",
      occurredAt: payment.workshopReservation.session?.startDate ?? null,
      invoiceSource: "WORKSHOP",
      ticketKind: "WORKSHOP",
      activityType: payment.workshopReservation.session?.workshop?.type ?? null,
      label: payment.workshopReservation.session?.workshop?.type === "EVENT" ? "Événement" : "Atelier",
      summary: description,
      customer: payment.workshopReservation.customer,
      isGoods: false,
      lines: buildServiceInvoiceLines({ description, totalAmount: total, discountAmount: Number(payment.discountAmount ?? 0) }),
    };
  }
  if (payment.formationReservation) {
    const title = payment.formationReservation.session?.formation?.title ?? "Formation";
    const description = `${title} (${seatsLabel(payment.formationReservation)})`;
    return {
      kind: "FORMATION",
      occurredAt: payment.formationReservation.session?.startDate ?? null,
      invoiceSource: "FORMATION",
      ticketKind: "FORMATION",
      label: "Formation",
      summary: description,
      customer: payment.formationReservation.customer,
      isGoods: false,
      lines: buildServiceInvoiceLines({ description, totalAmount: total, discountAmount: Number(payment.discountAmount ?? 0) }),
    };
  }
  return null;
}

/**
 * Records the accepted transfer on a counter payment, inside the caller's
 * transaction: one TRANSFER Transaction for what was still owed, the Payment
 * marked PAID, its ticket number, and — for a VAT-registered buyer, the same
 * rule as every other settlement — its invoice.
 *
 * The claim is conditional on the exact paidAmount just read, so two tabs
 * accepting the same transfer cannot both succeed.
 */
export async function acceptAwaitedTransferInTx(tx, { payment, reference, now = new Date() }) {
  const details = describeAwaitedTransfer(payment);
  if (!details) throw new Error("AWAITED_TRANSFER_UNKNOWN_SOURCE");

  const total = Number(payment.totalAmount);
  const alreadyPaid = Number(payment.paidAmount);
  const balance = roundMoney(total - alreadyPaid);
  // What was announced — a séance sold at the counter may promise only its
  // acompte by transfer. Never more than what is still owed.
  const awaited = payment.awaitedTransferAmount == null ? balance : Math.min(Number(payment.awaitedTransferAmount), balance);
  const received = roundMoney(awaited);
  if (!(received > 0)) throw new Error("AWAITED_TRANSFER_ALREADY_PAID");
  const paidAfter = roundMoney(alreadyPaid + received);
  const fullyPaid = roundMoney(total - paidAfter) <= 0.001;

  const claim = await tx.payment.updateMany({
    where: { id: payment.id, status: { in: ["PENDING", "PARTIALLY_PAID"] }, paidAmount: payment.paidAmount },
    data: {
      status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
      paidAmount: paidAfter,
      remainingAmount: fullyPaid ? 0 : roundMoney(total - paidAfter),
      ...(fullyPaid ? { paidAt: now } : {}),
      awaitedTransferAmount: null,
    },
  });
  if (claim.count === 0) throw new Error("AWAITED_TRANSFER_ALREADY_PAID");

  const collection = await tx.transaction.create({
    data: {
      paymentId: payment.id,
      amount: received,
      method: AWAITED_TRANSFER_METHOD,
      // An acompte paid by transfer is a DEPOSIT, like every other acompte.
      transactionType: fullyPaid ? "FINAL_PAYMENT" : "DEPOSIT",
      paidAt: now,
      manualReference: reference?.trim() || null,
      // A transfer never touches the drawer, so it never joins the cash book.
      cashSessionId: null,
      pieceNumber: null,
    },
  });

  // The buyer's own ticket, exactly as the counter would have allocated it
  // had they paid on the spot — and, like everywhere else, only once the
  // whole amount is in. An independent's sale never reaches here: her
  // payments are off-till and carry payeeStaffId (see resolve-payee).
  if (fullyPaid) {
    await allocatePaymentTicketNumber(tx, payment.id, details.ticketKind, details.activityType ?? null, now, false);
  }

  // Same rules as every settlement: an invoice only once the sale is fully
  // paid, and only for a VIES-valid VAT identity — a particulier gets the
  // ticket alone.
  let invoice = null;
  const customer = details.customer ?? customerForPayment(payment);
  if (fullyPaid && !payment.invoice && hasInvoiceableVatIdentity(customer)) {
    const policy = details.isGoods ? resolveGoodsVatPolicy({ customer }) : resolveServiceVatPolicy({ customer });
    invoice = await issueInvoice(tx, {
      paymentId: payment.id,
      source: details.invoiceSource,
      totalInclVat: total,
      customer: buildInvoiceCustomer(customer),
      lines: details.lines,
      vatRate: policy.vatRate,
      vatTreatment: policy.vatTreatment,
      taxCountryCode: policy.taxCountryCode,
      taxNote: policy.taxNote,
    });
  }

  // A séance's seat is confirmed by its deposit, so the caller sends the
  // confirmation and its check-in QR even when a balance is still due.
  //
  // Only when NOTHING had been paid before, though. That is exactly the case
  // where the booking itself was announced by transfer, so createCounterReservation
  // deliberately sent nothing and the client has no ticket. A balance paid by
  // transfer at the door is the opposite: the deposit already confirmed the
  // seat and the client has held the QR since booking — re-sending it would
  // be a second, confusing confirmation for a seat they already have.
  const wasUnpaidBefore = alreadyPaid <= 0.001;
  const reservationRow = payment.workshopReservation
    ? { kind: "WORKSHOP", row: payment.workshopReservation }
    : payment.formationReservation
      ? { kind: "FORMATION", row: payment.formationReservation }
      : null;
  const reservation = wasUnpaidBefore ? reservationRow : null;

  return { received, invoice, details, fullyPaid, transactionId: collection.id, reservation };
}
