/**
 * Shared Stripe Connect account/capability interpreter.
 *
 * Single interpretation layer for "what is this staff member's REAL Stripe
 * state?". Stripe remains the source of truth — this module contains only
 * pure functions over live Stripe payloads:
 *   - `stripe.accounts.retrieve()` → account object
 *   - `stripe.accounts.retrieveCapability(accountId, "card_payments")`
 *     → capability object
 *
 * No DB field is introduced or read here: `cardPaymentsEnabled`-style
 * columns are explicitly forbidden — the DB keeps only `stripeAccountId`
 * (+ the pre-existing charges/payouts cache + permission flags).
 *
 * Two distinct statuses are derived:
 *   1. Account level  — 🟢 Actif / 🟠 Limité / 🔴 Désactivé
 *      (⚪ Non connecté is a UI state when no stripeAccountId exists.)
 *   2. Card level     — 🟢 Activés / 🟠 Activation en cours /
 *      🔴 Non activés / 🔴 Action requise, from the REAL `card_payments`
 *      capability (`status`, `requested`, `requested_at`) plus its
 *      requirements (`currently_due`, `past_due`, `errors`,
 *      `pending_verification`, `disabled_reason`).
 *
 * "Compte connecté" is NEVER equated with "paiements par carte disponibles".
 */

/**
 * @param {object} account - live Stripe Account object
 * @returns {{
 *   accountLevel: "active"|"limited"|"disabled",
 *   chargesEnabled: boolean,
 *   payoutsEnabled: boolean,
 *   detailsSubmitted: boolean,
 *   disabledReason: string|null,
 *   label: string,
 * }}
 */
export function getStripeAccountLevel(account = {}) {
  const chargesEnabled = account?.charges_enabled ?? false;
  const payoutsEnabled = account?.payouts_enabled ?? false;
  const detailsSubmitted = account?.details_submitted ?? false;
  const disabledReason = account?.requirements?.disabled_reason ?? null;

  let accountLevel = "limited";
  if (disabledReason) {
    accountLevel = "disabled";
  } else if (chargesEnabled && payoutsEnabled) {
    accountLevel = "active";
  }

  const label =
    accountLevel === "active"
      ? "Actif"
      : accountLevel === "disabled"
        ? "Désactivé / Problème"
        : "Limité / Action requise";

  return {
    accountLevel,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    disabledReason,
    label,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {object} account - live Stripe Account object
 *   (`stripe.accounts.retrieve()`)
 * @param {object|null} capability - live card_payments Capability object
 *   (`stripe.accounts.retrieveCapability(accountId, "card_payments")`).
 *   May be null (older accounts / API hiccup) — falls back to the
 *   `account.capabilities` map + account-level requirements.
 * @returns {{
 *   cardPayments: "active"|"pending"|"inactive"|"unrequested"|"unknown",
 *   cardRequested: boolean,
 *   cardRequestedAt: number|null,
 *   chargesEnabled: boolean,
 *   payoutsEnabled: boolean,
 *   detailsSubmitted: boolean,
 *   currentlyDue: string[],
 *   pastDue: string[],
 *   errors: Array<{ code?: string, requirement?: string, reason?: string }>,
 *   pendingVerification: string[],
 *   disabledReason: string|null,
 *   level: "ready"|"pending"|"action_required",
 *   canRequest: boolean,
 *   actionNeeded: boolean,
 *   label: string,
 *   detail: string,
 * }}
 */
export function getCardPaymentsStatus(account = {}, capability = null) {
  const mapStatus = capability?.status ?? account?.capabilities?.card_payments ?? null;
  const allowed = new Set(["active", "pending", "inactive", "unrequested"]);
  const cardPayments = allowed.has(mapStatus) ? mapStatus : "unknown";

  // `requested` only exists on the Capability object. Without it, a status
  // other than unrequested/unknown implies a request was made.
  const cardRequested =
    typeof capability?.requested === "boolean"
      ? capability.requested
      : cardPayments !== "unrequested" && cardPayments !== "unknown";
  const cardRequestedAt =
    typeof capability?.requested_at === "number" ? capability.requested_at : null;

  const chargesEnabled = account?.charges_enabled ?? false;
  const payoutsEnabled = account?.payouts_enabled ?? false;
  const detailsSubmitted = account?.details_submitted ?? false;

  // Capability requirements take precedence when present; otherwise fall
  // back to the account-level requirements snapshot.
  const capReq = capability?.requirements ?? null;
  const accReq = account?.requirements ?? {};
  const requirements = capReq ?? accReq;
  const currentlyDue = asArray(requirements.currently_due);
  const pastDue = asArray(requirements.past_due);
  const errors = asArray(requirements.errors);
  const pendingVerification = asArray(requirements.pending_verification);
  const disabledReason = requirements.disabled_reason ?? null;

  const hasHardBlock =
    pastDue.length > 0 || errors.length > 0 || Boolean(disabledReason);

  let level;
  if (cardPayments === "active" && chargesEnabled && !hasHardBlock) {
    level = "ready";
  } else if (hasHardBlock) {
    level = "action_required";
  } else if (cardPayments === "pending") {
    // Requested and under Stripe review. Past-due/errors already escalated
    // to action_required above via hasHardBlock; anything else here is
    // genuinely "in progress" (possibly with currently_due items being
    // collected or pending_verification running at Stripe).
    level = "pending";
  } else if (cardPayments === "active") {
    // Active capability but charges disabled (or edge): not usable yet.
    level = "pending";
  } else {
    // inactive / unrequested / unknown → card payments unavailable.
    // Inactive with requirements overdue is not "just inactive", the admin
    // must act — but the level stays action_required either way.
    level = "action_required";
  }

  const canRequest = cardPayments !== "active" && !cardRequested;
  const actionNeeded = level !== "ready";

  let label = "Paiements par carte activés";
  let detail =
    "Le compte peut accepter les paiements par carte. Aucune action requise.";
  if (level === "pending") {
    label = "Activation en cours";
    detail =
      "La demande est en cours de traitement par Stripe. Les paiements par carte ne sont pas encore disponibles — demandez au professionnel de patienter ou de vérifier son onboarding.";
  }
  if (level === "action_required") {
    if (cardPayments === "inactive" || cardPayments === "unrequested" || cardPayments === "unknown") {
      label = "Paiements par carte non activés";
    } else {
      label = "Action requise";
    }
    const parts = [];
    if (pastDue.length > 0) parts.push(`${pastDue.length} élément(s) en retard`);
    if (errors.length > 0) parts.push(`${errors.length} erreur(s) à corriger`);
    if (currentlyDue.length > 0 && pastDue.length === 0 && errors.length === 0)
      parts.push(`${currentlyDue.length} élément(s) demandé(s) par Stripe`);
    if (pendingVerification.length > 0)
      parts.push(`${pendingVerification.length} vérification(s) en cours chez Stripe`);
    if (disabledReason) parts.push(`motif : ${disabledReason}`);
    if (!cardRequested) parts.push("capability card_payments non demandée");
    else if (cardPayments === "inactive") parts.push("capability card_payments inactive");
    detail =
      "Votre compte Stripe est connecté, mais les paiements par carte ne sont pas encore activés." +
      (parts.length > 0 ? ` (${parts.join(", ")}).` : "");
  }

  return {
    cardPayments,
    cardRequested,
    cardRequestedAt,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDue,
    pastDue,
    errors,
    pendingVerification,
    disabledReason,
    level,
    canRequest,
    actionNeeded,
    label,
    detail,
  };
}

/**
 * Maps a Stripe Checkout Session creation failure to the clear,
 * customer-facing message, instead of leaking a raw Stripe capability error.
 *
 * Used by the checkout guards (createCheckoutSession, resume, resend) as a
 * last line of defence: the DB guards normally block before Stripe is ever
 * called, but a stale cache (webhook not yet received) can still let a call
 * through — this keeps the customer-facing error comprehensible.
 *
 * @param {unknown} error - error thrown by stripe.checkout.sessions.create
 * @returns {string|null} friendly message, or null if the error is unrelated
 */
export function mapStripeCapabilityError(error) {
  const rawMessage = String(
    error?.raw?.message ?? error?.message ?? ""
  ).toLowerCase();
  const code = String(error?.raw?.code ?? error?.code ?? "").toLowerCase();

  const needles = [
    "card_payments",
    "capabilit",
    "charges_enabled",
    "charges are not enabled",
    "account_invalid",
    "payouts_enabled",
    "requirements",
    "restricted",
    "disabled",
  ];

  if (code.includes("account_") || needles.some((n) => rawMessage.includes(n))) {
    return "Le paiement par carte est temporairement indisponible pour ce prestataire.";
  }
  return null;
}

/**
 * Builds the single live-payload shape shared by every live reader
 * (per-account details, bulk table load, capability request result).
 * Pure — same inputs always give the same payload.
 *
 * @param {{ staffId: string, stripeAccountId: string, account: object, capability: object|null }} args
 */
/**
 * Display state for staff tables listing many accounts at once.
 *
 * "Connected" (the account exists and is retrievable on Stripe) and "card
 * payments enabled" (the REAL card_payments capability is active and usable)
 * are two different statuses and must never be confused: a connected account
 * with unfinished onboarding is NOT "non connecté", it requires action.
 *
 * @param {{ stripeAccountId?: string|null, stripeConnected?: boolean, stripeChargesEnabled?: boolean, stripePayoutsEnabled?: boolean }} staff
 * @returns {"connected"|"action_required"|"not_connected"}
 */
export function getStaffStripeDisplayState(staff = {}) {
  if (!staff.stripeAccountId || staff.stripeConnected === false) {
    return "not_connected";
  }
  if (staff.stripeChargesEnabled && staff.stripePayoutsEnabled) {
    return "connected";
  }
  return "action_required";
}

/**
 * Maps the live card `level` (derived from the REAL `card_payments`
 * capability — never from `charges_enabled` or `stripeAccountId` existence)
 * to the badge state shared by every "Paiements par carte" display, so the
 * "Capacités du compte" item and the dedicated card section can never
 * disagree: same input level → same badge.
 *
 * @param {string|null|undefined} level - "ready"|"pending"|"action_required"
 * @returns {"active"|"pending"|"inactive"}
 */
export function getCardCapabilityBadge(level) {
  if (level === "ready") return "active";
  if (level === "pending") return "pending";
  return "inactive";
}

/**
 * Builds the single live-payload shape shared by every live reader
 * (per-account details, bulk table load, capability request result).
 * Pure — same inputs always give the same payload.
 *
 * @param {{ staffId: string, stripeAccountId: string, account: object, capability: object|null }} args
 */
export function buildLiveStripePayload({ staffId, stripeAccountId, account, capability }) {
  const accountLevel = getStripeAccountLevel(account);
  const card = getCardPaymentsStatus(account, capability);
  return {
    staffId,
    stripeAccountId,
    connected: true,
    accountType: account.type ?? null,
    accountLevel: accountLevel.accountLevel,
    accountLabel: accountLevel.label,
    ...card,
  };
}
