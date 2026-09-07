/**
 * Whether a given refund is allowed to happen at all, and on what evidence.
 *
 * This is the module the handoff's problems #2 and #3 point at: "certains
 * remboursements administratifs peuvent contourner la demande écrite" and
 * "certains rendez-vous peuvent encore être remboursés directement hors de
 * la fenêtre des 48 heures". Both were possible because the rules lived as
 * prose in docs/REFUND_OPERATING_PROCEDURE.md and as scattered `if`s in five
 * separate action files, so a new call site simply inherited none of them.
 *
 * Every check here is pure — it takes already-loaded rows and returns a
 * verdict. openRefundOperation calls it INSIDE its locking transaction, on
 * freshly re-read rows, so a request approved in another tab a second ago
 * cannot slip past.
 */

/**
 * Statuses whose history must never be rewritten by a cancellation.
 *
 * COMPLETED was refundable until 2026-09-02 — see docs/QUESTIONS_FOR_MARIE.md
 * §5, where the entry is struck through. Marie had signed off on allowing a
 * goodwill refund after the service happened; the "annuler et rembourser"
 * handoff reverses that, and the reversal is deliberate rather than an
 * oversight, so it is enforced here for EVERY path rather than only for the
 * new dashboard button.
 */
const APPOINTMENT_HISTORICAL_STATUSES = Object.freeze(["COMPLETED", "NO_SHOW"]);

/** A booking that has not happened yet and can still be cancelled outright. */
const APPOINTMENT_ACTIVE_STATUSES = Object.freeze(["PENDING", "ACCEPTED", "CONFIRMED"]);

/**
 * Order statuses past the point where the goods have left the building.
 * Cancelling one in place would restore stock that is physically in a van.
 *
 * READY_FOR_PICKUP is deliberately absent: those items are on a shelf in the
 * salon, so that order IS still cancellable in place with a real stock
 * restore. EXPIRED likewise — nothing ever left.
 */
export const SHIPPED_ORDER_STATUSES = new Set(["SHIPPED", "COMPLETED"]);

export const REFUND_DENIAL = Object.freeze({
  NOT_ADMIN: "NOT_ADMIN",
  NO_PAYMENT_COLLECTED: "NO_PAYMENT_COLLECTED",
  REQUEST_REQUIRED: "REQUEST_REQUIRED",
  REQUEST_NOT_APPROVED: "REQUEST_NOT_APPROVED",
  REASON_REQUIRED: "REASON_REQUIRED",
  COMPLETED_NOT_REFUNDABLE: "COMPLETED_NOT_REFUNDABLE",
  ALREADY_CANCELLED: "ALREADY_CANCELLED",
  ORDER_ALREADY_SHIPPED: "ORDER_ALREADY_SHIPPED",
  RETURN_NOT_RECEIVED: "RETURN_NOT_RECEIVED",
  LEDGER_INCONSISTENT: "LEDGER_INCONSISTENT",
  REFUND_ALREADY_IN_FLIGHT: "REFUND_ALREADY_IN_FLIGHT",
});

/** French, because every one of these is shown to an admin as-is. */
const DENIAL_MESSAGES = Object.freeze({
  [REFUND_DENIAL.NOT_ADMIN]: "Seul un OWNER ou un ADMIN peut annuler et rembourser.",
  [REFUND_DENIAL.NO_PAYMENT_COLLECTED]:
    "Aucun paiement encaissé et non remboursé n'est enregistré — il n'y a rien à rembourser.",
  [REFUND_DENIAL.REQUEST_REQUIRED]:
    "Le client doit d'abord envoyer une demande écrite expliquant le cas exceptionnel. Aucun remboursement n'est possible sans elle.",
  [REFUND_DENIAL.REQUEST_NOT_APPROVED]:
    "La demande d'annulation du client n'a pas encore été approuvée.",
  [REFUND_DENIAL.REASON_REQUIRED]: "Un motif administratif est obligatoire.",
  [REFUND_DENIAL.COMPLETED_NOT_REFUNDABLE]:
    "Une prestation déjà marquée COMPLETED ne peut pas être remboursée par ce parcours. Son historique n'est jamais modifié.",
  [REFUND_DENIAL.ALREADY_CANCELLED]: "Cet élément est déjà annulé.",
  [REFUND_DENIAL.ORDER_ALREADY_SHIPPED]:
    "Cette commande est déjà expédiée : passez par le parcours de retour, après réception physique des articles.",
  [REFUND_DENIAL.RETURN_NOT_RECEIVED]:
    "Le retour doit être approuvé et les articles reçus avant tout remboursement.",
  [REFUND_DENIAL.LEDGER_INCONSISTENT]:
    "Les montants encaissés, remboursés et crédités sont incohérents. Cette opération part en réconciliation — aucun mouvement automatique.",
  [REFUND_DENIAL.REFUND_ALREADY_IN_FLIGHT]:
    "Un remboursement est déjà en cours sur ce paiement. Attendez qu'il se termine ou reprenez-le.",
});

export function refundDenialMessage(code) {
  return DENIAL_MESSAGES[code] ?? "Remboursement impossible.";
}

function deny(code, detail) {
  return { allowed: false, code, message: detail ?? refundDenialMessage(code) };
}

const ALLOW = Object.freeze({ allowed: true, code: null, message: null });

/**
 * A written customer request is mandatory for every customer-initiated
 * cancellation of a paid booking — the handoff is explicit that this holds
 * "même plus de 48 heures avant la prestation", which is precisely the
 * loophole problem #3 describes.
 *
 * Note what is NOT checked here: how far away the prestation is. That is
 * intentional. The old code let an admin refund directly when the booking
 * was outside the 48h window, treating distance-in-time as its own
 * authorization. It is not one — only an approved request or a salon-side
 * decision is.
 */
function authorizeCustomerRequest(request) {
  if (!request) return deny(REFUND_DENIAL.REQUEST_REQUIRED);
  if (request.status !== "APPROVED") return deny(REFUND_DENIAL.REQUEST_NOT_APPROVED);
  return ALLOW;
}

/**
 * @param {object} input
 * @param {string} input.actorRole - the session user's role
 * @param {"APPOINTMENT"|"WORKSHOP"|"FORMATION"|"ORDER"|"POS"} input.source
 * @param {"CUSTOMER_REQUEST_APPROVED"|"SALON_CANCELLATION"|"NO_SHOW_EXCEPTION"|"SHOP_RETURN"} input.trigger
 * @param {string} input.reason
 * @param {{remainingRefundable: number, inconsistencies: Array}} input.state - from summarizeRefundState
 * @param {object|null} [input.appointment]
 * @param {object|null} [input.reservation] - workshop or formation reservation
 * @param {object|null} [input.order]
 * @param {object|null} [input.returnRequest]
 * @param {object|null} [input.cancellationRequest] - the approved request row, if any
 * @param {{pendingRefundAmount: unknown, refundOperations?: Array}|null} [input.payment]
 * @returns {{allowed: boolean, code: string|null, message: string|null}}
 */
export function authorizeRefund({
  actorRole,
  source,
  trigger,
  reason,
  state,
  appointment = null,
  reservation = null,
  order = null,
  returnRequest = null,
  cancellationRequest = null,
  payment = null,
}) {
  // ── Who ────────────────────────────────────────────────────────────────
  // OWNER/ADMIN only, confirmed in docs/QUESTIONS_FOR_MARIE.md §5. STAFF may
  // cancel unpaid things elsewhere; this path always moves money.
  if (actorRole !== "OWNER" && actorRole !== "ADMIN") return deny(REFUND_DENIAL.NOT_ADMIN);

  // ── Why ────────────────────────────────────────────────────────────────
  // A motive is mandatory for every trigger without exception: an approved
  // customer request carries the customer's words, but the admin still has
  // to say why they accepted it.
  if (!reason || reason.trim().length === 0) return deny(REFUND_DENIAL.REASON_REQUIRED);

  // ── Is there money, and does the ledger make sense ──────────────────────
  if (state?.inconsistencies?.length > 0) return deny(REFUND_DENIAL.LEDGER_INCONSISTENT);
  if (!(state?.remainingRefundable > 0)) return deny(REFUND_DENIAL.NO_PAYMENT_COLLECTED);

  // The interlock against the pre-RefundOperation refund machinery. While
  // the five legacy paths still write Payment.pendingRefund*, neither system
  // can see the other's in-flight state — so each must refuse when the
  // other is mid-flight. Without this, one admin cancelling from the old
  // atelier screen and another from the new Operations button both pass
  // their own guard and Stripe is called twice.
  if (payment?.pendingRefundAmount != null) return deny(REFUND_DENIAL.REFUND_ALREADY_IN_FLIGHT);

  // ── What is being unwound ──────────────────────────────────────────────
  if (source === "APPOINTMENT") {
    if (!appointment) return deny(REFUND_DENIAL.NO_PAYMENT_COLLECTED);

    if (appointment.status === "COMPLETED") {
      return deny(REFUND_DENIAL.COMPLETED_NOT_REFUNDABLE);
    }

    if (appointment.status === "NO_SHOW") {
      // The one case where the booking is NOT cancelled. It keeps NO_SHOW
      // and takes only a financial correction, so the historical fact that
      // the customer did not turn up survives the refund.
      if (trigger !== "NO_SHOW_EXCEPTION") {
        return deny(
          REFUND_DENIAL.REASON_REQUIRED,
          "Un rendez-vous NO_SHOW ne peut être remboursé qu'en exception administrative motivée.",
        );
      }
      return ALLOW;
    }

    if (appointment.status === "CANCELLED" || appointment.status === "REJECTED") {
      // Already cancelled is not an error for a reprise: the money may still
      // be owed. Only the cancellation half is skipped.
      return ALLOW;
    }

    if (!APPOINTMENT_ACTIVE_STATUSES.includes(appointment.status)) {
      return deny(REFUND_DENIAL.ALREADY_CANCELLED);
    }

    if (trigger === "CUSTOMER_REQUEST_APPROVED") return authorizeCustomerRequest(cancellationRequest);
    if (trigger === "SALON_CANCELLATION") return ALLOW;
    return deny(REFUND_DENIAL.REQUEST_REQUIRED);
  }

  if (source === "WORKSHOP" || source === "FORMATION") {
    if (!reservation) return deny(REFUND_DENIAL.NO_PAYMENT_COLLECTED);
    if (reservation.status === "COMPLETED") {
      return deny(REFUND_DENIAL.COMPLETED_NOT_REFUNDABLE);
    }
    if (reservation.status === "NO_SHOW") {
      if (trigger !== "NO_SHOW_EXCEPTION") {
        return deny(
          REFUND_DENIAL.REASON_REQUIRED,
          "Une absence ne peut être remboursée qu'en exception administrative motivée.",
        );
      }
      return ALLOW;
    }
    if (reservation.status === "CANCELLED") return ALLOW; // reprise
    if (trigger === "CUSTOMER_REQUEST_APPROVED") return authorizeCustomerRequest(cancellationRequest);
    if (trigger === "SALON_CANCELLATION") return ALLOW;
    return deny(REFUND_DENIAL.REQUEST_REQUIRED);
  }

  if (source === "ORDER") {
    if (!order) return deny(REFUND_DENIAL.NO_PAYMENT_COLLECTED);

    if (trigger === "SHOP_RETURN") {
      // Goods must physically be back and assessed. APPROVED means "we
      // accepted the return"; only COMPLETED means "we have the items".
      if (!returnRequest) return deny(REFUND_DENIAL.RETURN_NOT_RECEIVED);
      if (returnRequest.status !== "COMPLETED" && returnRequest.status !== "APPROVED") {
        return deny(REFUND_DENIAL.RETURN_NOT_RECEIVED);
      }
      return ALLOW;
    }

    // A shipped or delivered order is never cancelled in place — it goes
    // through the return path above, after the items come back.
    if (SHIPPED_ORDER_STATUSES.has(order.status)) return deny(REFUND_DENIAL.ORDER_ALREADY_SHIPPED);
    if (order.status === "CANCELLED") return ALLOW; // reprise
    return ALLOW;
  }

  if (source === "POS") {
    // A counter sale has no booking to cancel and no shipment to chase. The
    // motive + admin role checks above are the whole gate.
    return ALLOW;
  }

  return deny(REFUND_DENIAL.REASON_REQUIRED, "Origine de remboursement inconnue.");
}

/**
 * Whether this trigger cancels the underlying item, or only records money
 * moving. The NO_SHOW exception is the sole case that retains its historical
 * status while a refund is prepared.
 */
export function cancelsUnderlyingItem(trigger) {
  return trigger !== "NO_SHOW_EXCEPTION";
}

/**
 * Whether seats/stock go back on sale.
 *
 * Only a FULL refund releases capacity — docs/REFUND_OPERATING_PROCEDURE.md:
 * "un remboursement partiel ne doit pas libérer la place sans décision
 * explicite de l'équipe". A partially-refunded reservation is still a
 * reservation, and handing its seat to the waiting list would double-book it.
 */
export function releasesCapacity({ trigger, plannedTotal, remainingRefundable, epsilon = 0.01 }) {
  if (!cancelsUnderlyingItem(trigger)) return false;
  return Number(plannedTotal) + epsilon >= Number(remainingRefundable);
}
