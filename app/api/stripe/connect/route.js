import { auth } from "@/auth";
import { createConnectAccount } from "@/actions/stripe/createConnectAccount";
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

// ─── POST /api/stripe/connect ─────────────────────────────────────────────────
/**
 * Creates a Stripe Connect Express account for a staff member.
 *
 * Request body (optional when caller is STAFF):
 * {
 *   staffId?: string   // Required when caller is ADMIN/OWNER.
 *                       // When caller is STAFF, their own record is used.
 * }
 *
 * Responses:
 *   200 – Account created successfully or already exists
 *   400 – Missing staffId or invalid JSON body
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
    // STAFF member can only create an account for themselves
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
  let result;
  try {
    result = await createConnectAccount(staffId);
  } catch (error) {
    console.error("[POST /api/stripe/connect]", error);
    return serverError();
  }

  if (!result.success) {
    const lowerMsg = result.message.toLowerCase();
    if (lowerMsg.includes("introuvable")) return notFound(result.message);
    return badRequest(result.message);
  }

  return ok(
    { stripeAccountId: result.stripeAccountId },
    result.message
  );
}