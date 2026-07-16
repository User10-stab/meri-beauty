import { auth } from "@/auth";
import { updateIndependentStaff } from "@/actions/staff/update-independent-staff";
import {
  deleteIndependentStaff,
  hardDeleteIndependentStaff,
} from "@/actions/staff/delete-independent-staff";
import {
  unauthorized,
  forbidden,
  badRequest,
  notFound,
  ok,
  serverError,
  prismaError,
} from "@/lib/api-response";
import { requireRole, ROLES } from "@/lib/authorization";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await auth();
  const authError = requireRole(session, [ROLES.ADMIN, ROLES.OWNER], unauthorized, forbidden);
  if (authError) return { error: authError };
  return { session };
}

// ─── PATCH /api/staff/:id ─────────────────────────────────────────────────────
/**
 * Updates an independent staff member's profile, services and/or contract.
 *
 * Request body (all fields optional except none — at least one must be present)
 * Responses:
 *   200 – updated successfully
 *   400 – missing / malformed body
 *   401 – not authenticated
 *   403 – insufficient role
 *   404 – staff not found
 *   409 – unique constraint violation (phone)
 *   422 – validation errors
 *   500 – unexpected server error
 */
export async function PATCH(request, { params }) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  // ── Parse body ───────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Le corps de la requête n'est pas un JSON valide.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("Le corps de la requête doit être un objet JSON.");
  }

  const { id } = await params;

  if (!id) {
    return badRequest("L'identifiant du profil est manquant dans l'URL.");
  }

  // ── Delegate to server action ────────────────────────────────────────────
  let result;
  try {
    result = await updateIndependentStaff({ id, ...body });
  } catch (error) {
    const mapped = prismaError(error);
    if (mapped) return mapped;
    console.error("[PATCH /api/staff/:id]", error);
    return serverError();
  }

  if (!result.success) {
    // Distinguish validation errors from business-logic errors
    if (result.errors) {
      return ok(null, result.message, 422);
    }

    const lowerMsg = result.message.toLowerCase();
    if (lowerMsg.includes("introuvable")) return notFound(result.message);
    if (lowerMsg.includes("déjà utilisé")) {
      return ok(null, result.message, 409);
    }

    return badRequest(result.message);
  }

  return ok(null, result.message);
}

// ─── DELETE /api/staff/:id ────────────────────────────────────────────────────
/**
 * Deactivates (soft-delete) or permanently removes an independent staff member.
 *
 * Query params:
 *   ?hard=true   → permanent delete (only when no appointments exist)
 *   (default)    → soft delete: sets isActive=false, terminates contract
 *
 * Soft-delete request body (optional):
 * {
 *   reason?: string   // optional reason recorded in server logs
 * }
 *
 * Responses:
 *   200 – deactivated / deleted successfully
 *   400 – missing id or invalid body
 *   401 – not authenticated
 *   403 – insufficient role
 *   404 – staff not found
 *   409 – cannot hard-delete because appointments exist
 *   500 – unexpected server error
 */
export async function DELETE(request, { params }) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const { id } = await params;

  if (!id) {
    return badRequest("L'identifiant du profil est manquant dans l'URL.");
  }

  // ── Determine mode ───────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const isHardDelete = searchParams.get("hard") === "true";

  // ── Hard delete ──────────────────────────────────────────────────────────
  if (isHardDelete) {
    let result;
    try {
      result = await hardDeleteIndependentStaff({ id });
    } catch (error) {
      const mapped = prismaError(error);
      if (mapped) return mapped;
      console.error("[DELETE /api/staff/:id?hard=true]", error);
      return serverError();
    }

    if (!result.success) {
      const lowerMsg = result.message.toLowerCase();
      if (lowerMsg.includes("introuvable")) return notFound(result.message);
      if (lowerMsg.includes("rendez-vous"))
        return ok(null, result.message, 409);
      return badRequest(result.message);
    }

    return ok(null, result.message);
  }

  // ── Soft delete ──────────────────────────────────────────────────────────
  // Parse optional body (reason)
  let reason = null;
  try {
    const text = await request.text();
    if (text.trim()) {
      const body = JSON.parse(text);
      if (typeof body?.reason === "string") reason = body.reason.trim() || null;
    }
  } catch {
    // Body is optional — ignore parse errors
  }

  let result;
  try {
    result = await deleteIndependentStaff({ id, reason });
  } catch (error) {
    const mapped = prismaError(error);
    if (mapped) return mapped;
    console.error("[DELETE /api/staff/:id]", error);
    return serverError();
  }

  if (!result.success) {
    const lowerMsg = result.message.toLowerCase();
    if (lowerMsg.includes("introuvable"))   return notFound(result.message);
    if (lowerMsg.includes("déjà désactivé")) return ok(null, result.message, 409);
    return badRequest(result.message);
  }

  return ok(null, result.message);
}
