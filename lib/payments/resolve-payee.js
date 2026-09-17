import { resolveSalonScope } from "@/lib/authorization/salon-scope";

/**
 * Whose money a payment is — answered once, when the Payment is created, and
 * frozen on `Payment.payeeStaffId`. Everything downstream (which Stripe
 * account is charged, whether a salon ticket/invoice/credit note is issued,
 * whether it counts in the salon's books, who may refund it) reads that
 * column. Nothing may decide it from who happens to be clicking.
 *
 * The rule:
 *   - an appointment belongs to the practitioner it is booked with;
 *   - a workshop/formation seat belongs to the session's animator (falling
 *     back to the activity's/formation's own animator), when that animator
 *     is a staff profile (`Animator.staffId`);
 *   - a boutique order or counter sale belongs to the salon;
 * and in every case the practitioner is the payee ONLY if she is an
 * INDEPENDENT who is not the salon itself. Marie Mercier's type is also
 * INDEPENDENT, but her VAT number is the salon's — resolveSalonScope() is the
 * one place that exemption lives, so it is reused here, never re-derived.
 * An EMPLOYEE's sale is the salon's.
 *
 * @typedef {{ id: string, type: string, userId: string, stripeAccountId: string|null,
 *   stripeChargesEnabled: boolean, stripePayoutsEnabled: boolean }} PayeeStaff
 * @typedef {{ payeeStaffId: string|null, staff: PayeeStaff|null }} Payee
 */

const STAFF_SELECT = {
  id: true,
  type: true,
  userId: true,
  isDeleted: true,
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
};

export const SALON_PAYEE = Object.freeze({ payeeStaffId: null, staff: null });

/**
 * @param {object} tx - Prisma client or transaction client
 * @param {{ staffId: string|null|undefined }} source - the practitioner's Staff.id
 * @returns {Promise<Payee>}
 */
export async function resolvePayeeForStaff(tx, { staffId }) {
  if (!staffId) return SALON_PAYEE;
  const staff = await tx.staff.findUnique({ where: { id: staffId }, select: STAFF_SELECT });
  if (!staff || staff.type !== "INDEPENDENT") return SALON_PAYEE;

  const { salonStaffIds } = await resolveSalonScope(tx);
  if (salonStaffIds.includes(staff.id)) return SALON_PAYEE;

  const { isDeleted: _isDeleted, ...payee } = staff;
  return { payeeStaffId: staff.id, staff: payee };
}

/** @returns {Promise<Payee>} */
export async function resolvePayeeForAppointment(tx, { staffId }) {
  return resolvePayeeForStaff(tx, { staffId });
}

/** @returns {Promise<Payee>} */
export async function resolvePayeeForWorkshopSession(tx, { sessionId }) {
  if (!sessionId) return SALON_PAYEE;
  const session = await tx.workshopSession.findUnique({
    where: { id: sessionId },
    select: {
      animator: { select: { staffId: true } },
      workshop: { select: { animator: { select: { staffId: true } } } },
    },
  });
  const staffId = session?.animator?.staffId ?? session?.workshop?.animator?.staffId ?? null;
  return resolvePayeeForStaff(tx, { staffId });
}

/** @returns {Promise<Payee>} */
export async function resolvePayeeForFormationSession(tx, { sessionId }) {
  if (!sessionId) return SALON_PAYEE;
  const session = await tx.formationSession.findUnique({
    where: { id: sessionId },
    select: {
      animator: { select: { staffId: true } },
      formation: { select: { animator: { select: { staffId: true } } } },
    },
  });
  const staffId = session?.animator?.staffId ?? session?.formation?.animator?.staffId ?? null;
  return resolvePayeeForStaff(tx, { staffId });
}

/**
 * Whether the payee can take an online payment on her own Stripe account.
 * The salon (payee null) always can — it charges the platform account.
 *
 * @param {Payee} payee
 */
export function payeeCanChargeOnline(payee) {
  if (!payee.staff) return true;
  const { stripeAccountId, stripeChargesEnabled, stripePayoutsEnabled } = payee.staff;
  return Boolean(stripeAccountId && stripeChargesEnabled && stripePayoutsEnabled);
}

/**
 * The Stripe request options for a Checkout Session charged to the payee:
 * a direct charge on her connected account, or the platform account.
 *
 * @param {Payee} payee
 * @returns {{ stripeAccount: string } | undefined}
 */
export function payeeStripeOptions(payee) {
  return payee.staff?.stripeAccountId ? { stripeAccount: payee.staff.stripeAccountId } : undefined;
}

/**
 * The columns to write on a new Payment.
 *
 * `stripeAccountId` is the account the online charge is actually created on,
 * which is NOT always the payee's: an appointment with Marie is the salon's
 * money (payee null) yet has always been a direct charge on her own connected
 * account. Pass the account the Checkout Session uses, or null for no online
 * charge / the platform account.
 *
 * @param {Payee} payee
 * @param {{ stripeAccountId?: string|null }} [options]
 */
export function payeePaymentData(payee, { stripeAccountId = null } = {}) {
  return { payeeStaffId: payee.payeeStaffId, stripeAccountId };
}

/** True when a payment belongs to an independent, not the salon. */
export function isIndependentPayment(payment) {
  return Boolean(payment?.payeeStaffId);
}

/**
 * The Staff.id an animator with this e-mail IS, or null for an outside
 * animator. Written onto `Animator.staffId` wherever an animator is created
 * or re-addressed, so payee resolution never has to match e-mails itself.
 *
 * @param {object} tx
 * @param {string|null|undefined} email
 * @returns {Promise<string|null>}
 */
export async function staffIdForAnimatorEmail(tx, email) {
  if (!email) return null;
  const staff = await tx.staff.findFirst({
    where: { isDeleted: false, user: { email: { equals: email, mode: "insensitive" } } },
    select: { id: true },
  });
  return staff?.id ?? null;
}

/**
 * Every Staff.id that would be a payee (INDEPENDENT and not the salon), for
 * the raw-SQL ledger that cannot call resolvePayeeForStaff per row. Deleted
 * profiles are kept: a practitioner leaving does not make her past sales the
 * salon's.
 *
 * @param {object} tx
 * @returns {Promise<string[]>}
 */
export async function listIndependentPayeeStaffIds(tx) {
  const [{ salonStaffIds }, staff] = await Promise.all([
    resolveSalonScope(tx),
    tx.staff.findMany({ where: { type: "INDEPENDENT" }, select: { id: true } }),
  ]);
  return staff.map((s) => s.id).filter((id) => !salonStaffIds.includes(id));
}
