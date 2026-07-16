import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  updateRentalRequestSchema,
  updateRentalRequestStatusSchema,
} from "@/lib/validations/rental-request";
import {
  badRequest,
  ok,
  notFound,
  serverError,
  prismaError,
  unauthorized,
  forbidden,
  noContent,
} from "@/lib/api-response";
import { auth } from "@/auth";
import { requireDashboardAuth } from "@/lib/authorization";

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireAuth() {
  const session = await auth();
  const authError = requireDashboardAuth(session, unauthorized, forbidden);
  if (authError) return { error: authError };
  return { session };
}

// ─── GET /api/rental-requests/:id ─────────────────────────────────────────────
/**
 * Retrieves a single rental request by ID.
 * 
 * Responses:
 *   200 - rental request found
 *   401 - not authenticated
 *   403 - insufficient role
 *   404 - rental request not found
 *   500 - unexpected server error
 */
export async function GET(request, { params }) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { id } = await params;

  if (!id) {
    return badRequest("L'identifiant de la demande de location est manquant.");
  }

  try {
    const rentalRequest = await prisma.rentalRequest.findFirst({
      where: {
        id,
        isDeleted: false,
      },
    });

    if (!rentalRequest) {
      return notFound("Demande de location introuvable.");
    }

    return ok(rentalRequest);
  } catch (error) {
    console.error(`[GET /api/rental-requests/${id}]`, error);
    return serverError();
  }
}

// ─── PATCH /api/rental-requests/:id ───────────────────────────────────────────
/**
 * Updates a rental request.
 * 
 * Request body (all fields optional):
 * {
 *   rentalType?: string,
 *   startDate?: string (ISO date),
 *   endDate?: string (ISO date),
 *   commissionType?: "PERCENTAGE" | "FIXED" | "HYBRID",
 *   status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED",
 *   message?: string,
 *   ownerResponse?: string
 * }
 * 
 * Responses:
 *   200 - rental request updated successfully
 *   400 - missing or malformed body
 *   401 - not authenticated
 *   403 - insufficient role
 *   404 - rental request not found
 *   422 - validation errors
 *   500 - unexpected server error
 */
export async function PATCH(request, { params }) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { id } = await params;

  if (!id) {
    return badRequest("L'identifiant de la demande de location est manquant.");
  }

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

  // ── Validate input ───────────────────────────────────────────────────────
  const validationResult = updateRentalRequestSchema.safeParse({
    id,
    ...body,
  });

  if (!validationResult.success) {
    const errors = validationResult.error.errors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return badRequest("Validation échouée.", errors);
  }

  const {
    rentalType,
    startDate,
    endDate,
    commissionType,
    status,
    message,
    ownerResponse,
  } = validationResult.data;

  // ── Prepare update data ──────────────────────────────────────────────────
  const updateData = {};

  if (rentalType !== undefined) updateData.rentalType = rentalType;
  if (startDate !== undefined) updateData.startDate = new Date(startDate);
  if (endDate !== undefined) updateData.endDate = new Date(endDate);
  if (commissionType !== undefined) updateData.commissionType = commissionType;
  if (status !== undefined) updateData.status = status;
  if (message !== undefined) updateData.message = message;
  if (ownerResponse !== undefined) updateData.ownerResponse = ownerResponse;

  // If no fields to update, return early
  if (Object.keys(updateData).length === 0) {
    return badRequest("Aucun champ à mettre à jour.");
  }

  // ── Update rental request ────────────────────────────────────────────────
  try {
    const rentalRequest = await prisma.rentalRequest.update({
      where: {
        id,
        isDeleted: false,
      },
      data: updateData,
    });

    return ok(rentalRequest, "Demande de location mise à jour avec succès.");
  } catch (error) {
    if (error.code === "P2025") {
      return notFound("Demande de location introuvable.");
    }
    const mapped = prismaError(error);
    if (mapped) return mapped;
    console.error(`[PATCH /api/rental-requests/${id}]`, error);
    return serverError();
  }
}

// ─── DELETE /api/rental-requests/:id ──────────────────────────────────────────
/**
 * Soft-deletes a rental request.
 * 
 * Query parameters:
 *   ?hard=true - permanently delete (only when no related records exist)
 * 
 * Responses:
 *   204 - rental request deleted successfully
 *   400 - missing id
 *   401 - not authenticated
 *   403 - insufficient role
 *   404 - rental request not found
 *   409 - cannot hard-delete because related records exist
 *   500 - unexpected server error
 */
export async function DELETE(request, { params }) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { id } = await params;

  if (!id) {
    return badRequest("L'identifiant de la demande de location est manquant.");
  }

  // ── Determine mode ───��───────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const isHardDelete = searchParams.get("hard") === "true";

  // ── Hard delete ──────────────────────────────────────────────────────────
  if (isHardDelete) {
    try {
      await prisma.rentalRequest.delete({
        where: { id },
      });

      return noContent();
    } catch (error) {
      if (error.code === "P2025") {
        return notFound("Demande de location introuvable.");
      }
      console.error(`[DELETE /api/rental-requests/${id}?hard=true]`, error);
      return serverError();
    }
  }

  // ── Soft delete ──────────────────────────────────────────────────────────
  try {
    await prisma.rentalRequest.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return noContent();
  } catch (error) {
    if (error.code === "P2025") {
      return notFound("Demande de location introuvable.");
    }
    console.error(`[DELETE /api/rental-requests/${id}]`, error);
    return serverError();
  }
}