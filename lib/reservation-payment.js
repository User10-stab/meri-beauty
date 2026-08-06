/**
 * lib/reservation-payment.js
 *
 * Single source of truth for the payment-related business rules in the
 * reservation flow. The helper is intentionally server-side and pure:
 * it only returns a decision object and does not perform Stripe calls,
 * emails, or database writes.
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

/**
 * Resolve the payment decision for a reservation.
 *
 * This service encapsulates the business rules needed by future Stripe
 * Checkout, webhook handlers, and reservation creation flows:
 *
 * - Multiple appointments: no payment step; no online payment required.
 * - Single appointment + MANUAL confirmation: create an appointment in
 *   PENDING state and defer payment until staff acceptance.
 * - Single appointment + AUTOMATIC confirmation:
 *   - online choice => full amount paid online now
 *   - salon choice + deposit enabled => deposit amount paid online now
 *   - salon choice + deposit disabled => no online payment required
 *
 * @param {{
 *   appointmentCount?: number,
 *   confirmationMode?: "AUTOMATIC" | "MANUAL" | string,
 *   depositEnabled?: boolean,
 *   depositPercentage?: number,
 *   totalAmount?: number,
 *   paymentMethod?: "online" | "cash" | null,
 * }} params
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
 *   requiresOnlinePaymentNow: boolean,
 *   paymentIntent: "NONE" | "FULL_ONLINE" | "DEPOSIT_ONLINE" | "NO_ONLINE_PAYMENT",
 *   paymentType: "ON_SITE" | "ONLINE" | "DEPOSIT",
 *   shouldCreatePaymentRecord: boolean,
 *   appointmentStatusBeforePayment: "PENDING" | "CONFIRMED",
 *   appointmentStatusAfterPayment: "CONFIRMED",
 *   requiresPaymentBeforeConfirmation: boolean,
 *   requiresOptionalDepositPrompt: boolean,
 * }}
 */
export function getReservationPaymentDecision({
  appointmentCount = 1,
  confirmationMode = "MANUAL",
  depositEnabled = false,
  depositPercentage = 0,
  totalAmount = 0,
  paymentMethod = null,
} = {}) {
  const normalizedConfirmationMode = String(confirmationMode ?? "MANUAL").toUpperCase();
  const normalizedPaymentMethod = paymentMethod === "online" ? "online" : paymentMethod === "cash" ? "cash" : null;
  const total = Number(totalAmount ?? 0);
  const depositPct = Number(depositPercentage ?? 0);
  const depositRequired = Boolean(depositEnabled) && depositPct > 0;
  const depositAmount = computeDepositAmount(total, depositRequired, depositPct);

  if (appointmentCount !== 1) {
    return {
      requiresPaymentStep: false,
      isManualMode: false,
      onlineFullPaymentAvailable: false,
      salonPaymentAvailable: false,
      depositRequired: false,
      depositPercentage: 0,
      depositAmount: 0,
      totalAmount: total,
      requiresOnlinePaymentNow: false,
      paymentIntent: "NONE",
      paymentType: "ON_SITE",
      shouldCreatePaymentRecord: false,
      appointmentStatusBeforePayment: "PENDING",
      appointmentStatusAfterPayment: "CONFIRMED",
      requiresPaymentBeforeConfirmation: false,
      requiresOptionalDepositPrompt: false,
    };
  }

  if (normalizedConfirmationMode === "MANUAL") {
    return {
      requiresPaymentStep: false,
      isManualMode: true,
      onlineFullPaymentAvailable: false,
      salonPaymentAvailable: false,
      depositRequired: false,
      depositPercentage: 0,
      depositAmount: 0,
      totalAmount: total,
      requiresOnlinePaymentNow: false,
      paymentIntent: "NONE",
      paymentType: "ON_SITE",
      shouldCreatePaymentRecord: false,
      appointmentStatusBeforePayment: "PENDING",
      appointmentStatusAfterPayment: "CONFIRMED",
      requiresPaymentBeforeConfirmation: false,
      requiresOptionalDepositPrompt: false,
    };
  }

  let paymentIntent = depositRequired ? "DEPOSIT_ONLINE" : "NO_ONLINE_PAYMENT";
  let requiresOnlinePaymentNow = depositRequired;
  let paymentType = depositRequired ? "DEPOSIT" : "ON_SITE";

  if (normalizedPaymentMethod === "online") {
    paymentIntent = "FULL_ONLINE";
    requiresOnlinePaymentNow = true;
    paymentType = "ONLINE";
  } else if (normalizedPaymentMethod === "cash" && depositRequired) {
    paymentIntent = "DEPOSIT_ONLINE";
    requiresOnlinePaymentNow = true;
    paymentType = "DEPOSIT";
  } else if (normalizedPaymentMethod === "cash") {
    paymentIntent = "NO_ONLINE_PAYMENT";
    requiresOnlinePaymentNow = false;
    paymentType = "ON_SITE";
  }

  const requiresOptionalDepositPrompt = !depositRequired && normalizedPaymentMethod === "cash";

  return {
    requiresPaymentStep: true,
    isManualMode: false,
    onlineFullPaymentAvailable: true,
    salonPaymentAvailable: true,
    depositRequired,
    depositPercentage: depositPct,
    depositAmount,
    totalAmount: total,
    requiresOnlinePaymentNow,
    paymentIntent,
    paymentType,
    shouldCreatePaymentRecord: requiresOnlinePaymentNow,
    appointmentStatusBeforePayment: requiresOnlinePaymentNow ? "PENDING" : "CONFIRMED",
    appointmentStatusAfterPayment: "CONFIRMED",
    requiresPaymentBeforeConfirmation: requiresOnlinePaymentNow,
    requiresOptionalDepositPrompt,
  };
}

/**
 * Backward-compatible wrapper for the existing UI-facing helper.
 *
 * The reservation form still passes an array of drafts, so this adapter
 * preserves that contract while delegating all business decisions to the
 * shared server-side engine above.
 *
 * @param {{ drafts: Array<{ price?: number, staffService?: { staff?: { reservationConfirmationMode?: string, depositEnabled?: boolean, depositPercentage?: number } } }> }} params
 * @returns {ReturnType<typeof getReservationPaymentDecision>}
 */
export function computePaymentDecision({ drafts }) {
  const totalAmount = drafts.reduce((sum, draft) => sum + Number(draft?.price ?? 0), 0);
  const draft = drafts?.[0];
  const staff = draft?.staffService?.staff ?? {};

  return getReservationPaymentDecision({
    appointmentCount: drafts?.length ?? 0,
    confirmationMode: staff.reservationConfirmationMode,
    depositEnabled: Boolean(staff.depositEnabled),
    depositPercentage: Number(staff.depositPercentage ?? 0),
    totalAmount,
  });
}
