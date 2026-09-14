import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import {
  verifyStripeOAuthState,
  OAUTH_STATE_PURPOSE,
} from "@/lib/stripe-oauth";

/**
 * Stripe Connect OAuth Callback
 *
 * Stripe redirects the user's browser here after they authorize (or decline)
 * connecting their existing Stripe account to the platform.
 *
 * Flow:
 *   1. Handle explicit Stripe errors (user declined, etc.)
 *   2. Validate the signed `state` (signature, purpose, expiry) → staffId
 *   3. Exchange the authorization `code` for tokens → stripe_user_id
 *   4. Retrieve the connected account
 *   5. Duplicate protection: no other staff may own this account
 *   6. Validate the account type:
 *        - standard            → allowed
 *        - express (ours)      → allowed
 *        - express (external)  → rejected (clear message)
 *   7. Save stripeAccountId + synchronize charges/payouts
 *   8. Redirect back to the Payments page with a result
 *
 * The staff/account identity comes from the signed state token (not the
 * session), so lookups still work even if the session cookie expired while
 * the user was on Stripe's pages. But `state` itself travels through a
 * redirected URL and can leak (browser history, a referrer header, a shared
 * screen) within its 10-minute window — so the callback DOES still check
 * the live session once, purely to confirm whoever is completing the flow
 * right now is the same person who started it (state's embedded `userId`
 * must match `session.user.id`). No session at all is treated as a
 * mismatch, not silently allowed. The redirect URI is /api/... which the
 * middleware does not intercept.
 */

// ─── Redirect error keys ───────────────────────────────────────────────────────
// These keys are turned into user-facing French messages on the Payments page
// (UI wiring happens in a later step). Keeping keys instead of raw messages in
// the URL keeps redirects short and avoids leaking internals.

const ERROR_KEYS = {
  DECLINED: "declined",
  INVALID_STATE: "invalid_state",
  SESSION_MISMATCH: "session_mismatch",
  NO_CODE: "no_code",
  STAFF_NOT_FOUND: "staff_not_found",
  STAFF_INACTIVE: "staff_inactive",
  ALREADY_CONNECTED: "already_connected",
  DUPLICATE_ACCOUNT: "duplicate_account",
  FOREIGN_EXPRESS: "foreign_express",
  UNSUPPORTED_TYPE: "unsupported_type",
  EXCHANGE_FAILED: "exchange_failed",
  UNEXPECTED: "unexpected",
  NO_ACCESS: "no_access",
};

// ─── Redirect helper ──────────────────────────────────────────────────────────

/**
 * Redirect the user back to the Payments page with a result.
 *
 * Success uses `?success=true` so the existing PaymentsSettingsClient effect
 * that refreshes on success keeps working. Errors use `?stripeOAuthError=<key>`
 * which the UI maps to a user-facing message.
 *
 * When an OWNER/ADMIN completes the flow on a staff member's behalf,
 * `viewStaffId` keeps the `?staffId=` context so they land back on that
 * staff member's page instead of their own. Staff self flows omit it
 * (existing behavior, unchanged).
 */
function redirectToPayments(request, { success = false, error = null, viewStaffId = null } = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const url = new URL("/dashboard/payments", baseUrl);

  if (viewStaffId) {
    url.searchParams.set("staffId", viewStaffId);
  }
  if (success) {
    url.searchParams.set("success", "true");
  }
  if (error) {
    url.searchParams.set("stripeOAuthError", error);
  }

  return NextResponse.redirect(url);
}

// ─── GET /api/stripe/oauth/callback ───────────────────────────────────────────

export async function GET(request) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  // ── 1. User declined or Stripe returned an error ───────────────────────
  if (error) {
    return redirectToPayments(request, { error: ERROR_KEYS.DECLINED });
  }

  // ── 2. Validate the signed state ───────────────────────────────────────
  const decoded = verifyStripeOAuthState(state, OAUTH_STATE_PURPOSE);

  if (!decoded) {
    console.warn("[GET /api/stripe/oauth/callback] Invalid OAuth state");
    return redirectToPayments(request, { error: ERROR_KEYS.INVALID_STATE });
  }

  const staffId = decoded.staffId;

  // ── 2b. The person completing this flow must be the one who started it ──
  // state's signature/expiry only proves the token wasn't forged — it says
  // nothing about who currently holds it. Re-checking against the live
  // session closes that gap (see the file-level comment above).
  const session = await auth();
  if (!session?.user?.id || session.user.id !== decoded.userId) {
    console.warn("[GET /api/stripe/oauth/callback] Session/state userId mismatch");
    return redirectToPayments(request, { error: ERROR_KEYS.SESSION_MISMATCH });
  }

  // An OWNER/ADMIN completing the flow for a staff member stays on that
  // member's page afterwards. Staff self flows keep the existing redirect.
  const completingAsAdmin = isAdminRole(session.user.role);
  const viewStaffId = completingAsAdmin ? staffId : null;

  if (!code) {
    return redirectToPayments(request, { error: ERROR_KEYS.NO_CODE, viewStaffId });
  }

  // ── 3. Staff must still exist and be connectable ───────────────────────
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      isActive: true,
      isDeleted: true,
      stripeAccountId: true,
      userId: true,
      allowAdminStripeAccess: true,
    },
  });

  if (!staff) {
    return redirectToPayments(request, { error: ERROR_KEYS.STAFF_NOT_FOUND, viewStaffId });
  }
  if (staff.isDeleted || !staff.isActive) {
    return redirectToPayments(request, { error: ERROR_KEYS.STAFF_INACTIVE, viewStaffId });
  }

  // The permission may have been revoked while the admin was on Stripe's
  // pages — re-check before writing anything to the staff member's row.
  if (
    completingAsAdmin &&
    staff.userId !== session.user.id &&
    staff.allowAdminStripeAccess !== true
  ) {
    return redirectToPayments(request, { error: ERROR_KEYS.NO_ACCESS, viewStaffId });
  }

  // ── 4. Exchange the authorization code for tokens ──────────────────────
  let token;
  try {
    token = await stripe.oauth.token({
      grant_type: "authorization_code",
      code,
    });
  } catch (err) {
    console.error("[GET /api/stripe/oauth/callback] Token exchange failed:", err);
    return redirectToPayments(request, { error: ERROR_KEYS.EXCHANGE_FAILED, viewStaffId });
  }

  const stripeUserId = token?.stripe_user_id;
  if (!stripeUserId) {
    console.warn("[GET /api/stripe/oauth/callback] Missing stripe_user_id");
    return redirectToPayments(request, { error: ERROR_KEYS.EXCHANGE_FAILED, viewStaffId });
  }

  // ── 5. Retrieve the connected account ──────────────────────────────────
  let account;
  try {
    account = await stripe.accounts.retrieve(stripeUserId);
  } catch (err) {
    console.error("[GET /api/stripe/oauth/callback] Account retrieve failed:", err);
    return redirectToPayments(request, { error: ERROR_KEYS.UNEXPECTED, viewStaffId });
  }

  // ── 6. Do not silently replace an existing connection ──────────────────
  // If this staff already has a DIFFERENT account connected, reject with a
  // clear message instead of overwriting it. Future "Replace Stripe account"
  // support will branch from this check.
  if (staff.stripeAccountId && staff.stripeAccountId !== stripeUserId) {
    return redirectToPayments(request, { error: ERROR_KEYS.ALREADY_CONNECTED, viewStaffId });
  }

  // ── 7. Duplicate protection across staff members ───────────────────────
  // stripeAccountId is UNIQUE in the database, but we also check explicitly
  // so we can return a clear message before attempting to write. The unique
  // constraint remains the final backstop against races.
  const owner = await prisma.staff.findUnique({
    where: { stripeAccountId: stripeUserId },
    select: { id: true },
  });

  if (owner && owner.id !== staffId) {
    return redirectToPayments(request, { error: ERROR_KEYS.DUPLICATE_ACCOUNT, viewStaffId });
  }

  // ── 8. Validate the account type ───────────────────────────────────────
  //   standard            → any existing Stripe account connected via OAuth
  //   express (ours)      → an account this platform created earlier
  //   express (external)  → created by another platform → must reject
  if (account.type === "express") {
    // An Express account belongs to the platform that created it. It is
    // "ours" if it is already linked to this staff in our database (which
    // only happens for accounts created through this platform) or if its
    // metadata still carries the staffId this platform stamped at creation.
    const isOurs = Boolean(owner) || account.metadata?.staffId === staffId;

    if (!isOurs) {
      return redirectToPayments(request, { error: ERROR_KEYS.FOREIGN_EXPRESS, viewStaffId });
    }
  } else if (account.type !== "standard") {
    return redirectToPayments(request, { error: ERROR_KEYS.UNSUPPORTED_TYPE, viewStaffId });
  }

  // ── 9. Save the connection and synchronize capabilities ────────────────
  try {
    await prisma.staff.update({
      where: { id: staffId },
      data: {
        stripeAccountId: stripeUserId,
        stripeAccountType: account.type,
        stripeChargesEnabled: account.charges_enabled ?? false,
        stripePayoutsEnabled: account.payouts_enabled ?? false,
      },
    });
  } catch (err) {
    // Unique constraint violation — another staff grabbed the account first.
    if (err.code === "P2002") {
      return redirectToPayments(request, { error: ERROR_KEYS.DUPLICATE_ACCOUNT, viewStaffId });
    }
    throw err;
  }

  console.log(
    `[GET /api/stripe/oauth/callback] Staff ${staffId} connected ` +
    `Stripe account ${stripeUserId} (${account.type})`
  );

  return redirectToPayments(request, { success: true, viewStaffId });
}
