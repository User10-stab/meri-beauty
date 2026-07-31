import { auth } from "@/auth";
import { createAccountLink } from "@/actions/stripe/createAccountLink";
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

// ─── POST /api/stripe/onboarding ─────────────────────────────────────────────
/**
 * Generates a Stripe Account Link for onboarding a staff member's
 * Connect Express account.
 *
 * The route resolves the staffId, then delegates to the server action which
 * handles all validation (DB lookup, stripeAccountId existence, Stripe account
 * verification) internally.
 *
 * Request body (optional when caller is STAFF):
 * {
 *   staffId?: string   // Required when caller is ADMIN/OWNER.
 *                       // When caller is STAFF, their own record is used.
 * }
 *
 * Responses:
 *   200 – Onboarding link generated successfully
 *   400 – Missing staffId, staff has no Stripe account, or Stripe account invalid
 *   401 – Not authenticated
 *   403 – Insufficient role
 *   404 – Staff not found
 *   500 – Unexpected server error
 */
export async function POST(request) {
  // ── 1. Auth ─────────────────────────────────────────────────────────────
  const { error: authError, session } = await requireStaffOrAbove();
  if (authError) return authError;

  // ── 2. Parse body ───────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Le corps de la requête n'est pas un JSON valide.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Le corps de la requête doit être un objet JSON.");
  }

  // ── 3. Determine staffId ────────────────────────────────────────────────
  let staffId = body?.staffId;

  if (session.user.role === ROLES.STAFF) {
    // STAFF member can only generate an onboarding link for themselves
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

  // ── 4. Delegate to server action ────────────────────────────────────────
  // The server action handles:
  //   - Fetching the staff record (including stripeAccountId)
  //   - Verifying stripeAccountId exists
  //   - Verifying the account exists on Stripe (stripe.accounts.retrieve)
  //   - Generating the Account Link
  let result;
  try {
    result = await createAccountLink(staffId);
  } catch (error) {
    console.error("[POST /api/stripe/onboarding]", error);
    return serverError();
  }

  if (!result.success) {
    const lowerMsg = result.message.toLowerCase();
    if (lowerMsg.includes("introuvable")) return notFound(result.message);
    return badRequest(result.message);
  }

  return ok(
    { url: result.url },
    result.message
  );
}