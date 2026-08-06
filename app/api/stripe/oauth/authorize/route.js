import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  ok,
  serverError,
} from "@/lib/api-response";
import { requireRole, ROLES } from "@/lib/authorization";
import { buildStripeOAuthUrl } from "@/lib/stripe-oauth";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireStaffOrAbove() {
  const session = await auth();
  const authError = requireRole(
    session,
    [ROLES.STAFF, ROLES.OWNER, ROLES.ADMIN],
    unauthorized,
    forbidden
  );
  if (authError) return { error: authError };
  return { session };
}

// ─── Connect decision ──────────────────────────────────────────────────────────

/**
 * Determine whether a staff member can start the OAuth connect flow.
 *
 * A staff member who already has a stripeAccountId is NOT permanently
 * locked out of this flow — they are simply prevented from reconnecting
 * right now, with a clear message. This decision is centralised here so
 * future "Disconnect" / "Replace Stripe account" features can branch from
 * this single point (e.g. allow reconnecting after the current account is
 * disconnected) instead of spreading ad-hoc checks across the codebase.
 *
 * @param {{ stripeAccountId: string | null }} staff
 * @returns {{ allowed: boolean, message?: string }}
 */
function getConnectDecision(staff) {
  if (staff.stripeAccountId) {
    return {
      allowed: false,
      message:
        "Ce membre du staff dispose déjà d'un compte Stripe connecté. " +
        "Pour en connecter un autre, déconnectez d'abord le compte actuel.",
    };
  }

  return { allowed: true };
}

// ─── GET /api/stripe/oauth/authorize ──────────────────────────────────────────
/**
 * Starts the "Connect an existing Stripe account" flow.
 *
 * The route generates a signed OAuth state token bound to the staff member,
 * builds the Stripe Connect authorization URL, and returns it to the client.
 * The client then navigates the user to that URL (Stripe hosts the login /
 * authorization page).
 *
 * Query params (only used when the caller is ADMIN/OWNER):
 *   ?staffId=<id>   // The staff member to connect. When the caller is STAFF,
 *                    // their own record is used.
 *
 * Responses:
 *   200 – { url } authorization URL generated
 *   400 – Missing staffId, or the staff already has a Stripe account
 *   401 – Not authenticated
 *   403 – Insufficient role
 *   404 – Staff not found
 *   500 – Unexpected server error (e.g. missing OAuth env vars)
 */
export async function GET(request) {
  // ── 1. Auth ─────────────────────────────────────────────────────────────
  const { error: authError, session } = await requireStaffOrAbove();
  if (authError) return authError;

  // ── 2. Determine staffId ────────────────────────────────────────────────
  let staffId = request.nextUrl.searchParams.get("staffId");

  if (session.user.role === ROLES.STAFF) {
    // STAFF member can only connect an account for themselves
    const staff = await prisma.staff.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!staff) {
      return notFound("Aucun profil staff trouvé pour cet utilisateur.");
    }

    staffId = staff.id;
  }

  if (!staffId) {
    return badRequest("L'identifiant du staff est requis.");
  }

  // ── 3. Validate the staff member ────────────────────────────────────────
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      isActive: true,
      isDeleted: true,
      stripeAccountId: true,
    },
  });

  if (!staff) {
    return notFound("Staff introuvable.");
  }
  if (staff.isDeleted) {
    return badRequest("Le staff est supprimé.");
  }
  if (!staff.isActive) {
    return badRequest("Le staff n'est pas actif.");
  }

  // ── 4. Check the staff can connect another account ─────────────────────
  const decision = getConnectDecision(staff);
  if (!decision.allowed) {
    return badRequest(decision.message);
  }

  // ── 5. Build the OAuth authorization URL ────────────────────────────────
  let url;
  try {
    url = buildStripeOAuthUrl({ staffId: staff.id });
  } catch (error) {
    console.error("[GET /api/stripe/oauth/authorize]", error);
    return serverError();
  }

  return ok(
    { url },
    "URL d'autorisation Stripe générée avec succès."
  );
}
