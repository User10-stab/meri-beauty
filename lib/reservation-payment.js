/**
 * lib/reservation-payment.js
 *
 * Single source of truth for all payment decisions in the reservation flow.
 * Pure functions only — no database access, no side effects.
 *
 * ─── Payment decision tree ────────────────────────────────────────────────────
 *
 * Multiple appointments
 *   → requiresPaymentStep = false. Appointments are created directly.
 *
 * Single appointment — MANUAL confirmation mode
 *   → requiresPaymentStep = false.
 *   → Appointment is created with status PENDING.
 *   → Staff reviews the request:
 *       confirm → send the customer a payment link by email
 *       reject  → send the customer a rejection email
 *   (That staff-side email flow is handled separately from this helper.)
 *
 * Single appointment — AUTOMATIC mode
 *   → requiresPaymentStep = true. Customer always chooses a payment option.
 *
 *   Option A — "Payer en ligne par Stripe"
 *     → Full price paid upfront online. depositPercentage is irrelevant here.
 *     → Always available in AUTOMATIC mode.
 *
 *   Option B — "Payer au salon"
 *     → depositEnabled === false → no online charge; customer pays in full at
 *       the salon. The appointment is confirmed without any online payment.
 *     → depositEnabled === true  → customer pays depositPercentage % of the
 *       price online now; the remainder is collected at the salon.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Deposit computation ──────────────────────────────────────────────────────

/**
 * Calculate the deposit amount for a single service.
 * Returns 0 whenever a deposit is not applicable.
 *
 * @param {number} price               Service price in €
 * @param {boolean} depositEnabled
 * @param {number}  depositPercentage  0–100
 * @returns {number}
 */
export function computeDepositAmount(price, depositEnabled, depositPercentage) {
  if (!depositEnabled || depositPercentage <= 0) return 0;
  return Number(((price * depositPercentage) / 100).toFixed(2));
}

// ─── Main decision helper ─────────────────────────────────────────────────────

/**
 * Compute the full payment decision for the current reservation state.
 *
 * `drafts` is the `appointmentDrafts` array from `reservationData`.
 * Each draft must carry at minimum:
 *   { price, staffService: { staff: { reservationConfirmationMode, depositEnabled, depositPercentage } } }
 *
 * These fields are already present because `getStaffByService` selects them
 * and they are stored verbatim in the draft objects.
 *
 * @param {{ drafts: Array<{
 *   price: number,
 *   staffService: {
 *     staff: {
 *       reservationConfirmationMode: "AUTOMATIC" | "MANUAL",
 *       depositEnabled: boolean,
 *       depositPercentage: number,
 *     }
 *   }
 * }> }} params
 *
 * @returns {{
 *   requiresPaymentStep: boolean,
 *   isManualMode: boolean,
 *   onlineFullPaymentAvailable: boolean,
 *   salonPaymentAvailable: boolean,
 *   depositRequired: boolean,
 *   depositPercentage: number,
 *   depositAmount: number,
 *   totalAmount: number,
 * }}
 */
export function computePaymentDecision({ drafts }) {
  const totalAmount = drafts.reduce((sum, d) => sum + Number(d.price ?? 0), 0);

  // ── Multiple appointments: skip payment entirely ──────────────────────────
  if (drafts.length !== 1) {
    return {
      requiresPaymentStep:        false,
      isManualMode:               false,
      onlineFullPaymentAvailable: false,
      salonPaymentAvailable:      false,
      depositRequired:            false,
      depositPercentage:          0,
      depositAmount:              0,
      totalAmount,
    };
  }

  // ── Single appointment ────────────────────────────────────────────────────
  const draft = drafts[0];
  const staff = draft?.staffService?.staff ?? {};

  const confirmationMode = staff.reservationConfirmationMode ?? "MANUAL";
  const depositEnabled   = Boolean(staff.depositEnabled);
  const depositPct       = Number(staff.depositPercentage ?? 0);
  const price            = Number(draft?.price ?? 0);

  // MANUAL: staff confirms/rejects; no online payment step
  if (confirmationMode === "MANUAL") {
    return {
      requiresPaymentStep:        false,
      isManualMode:               true,
      onlineFullPaymentAvailable: false,
      salonPaymentAvailable:      false,
      depositRequired:            false,
      depositPercentage:          0,
      depositAmount:              0,
      totalAmount,
    };
  }

  // AUTOMATIC: customer always sees the payment step to choose how to pay
  const depositAmount = computeDepositAmount(price, depositEnabled, depositPct);

  return {
    requiresPaymentStep:        true,
    isManualMode:               false,
    onlineFullPaymentAvailable: true,   // "Payer en ligne" — full price, always available
    salonPaymentAvailable:      true,   // "Payer au salon" — always available
    depositRequired:            depositEnabled,
    depositPercentage:          depositPct,
    depositAmount,                      // 0 when depositEnabled is false
    totalAmount,
  };
}
