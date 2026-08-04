import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createRentalRequestSchema } from "@/lib/validations/rental-request";
import {
  badRequest,
  created,
  serverError,
  prismaError,
  ok,
  unauthorized,
  forbidden,
} from "@/lib/api-response";
import { auth } from "@/auth";
import { requireCustomer, hasPermission, DASHBOARD_PERMISSIONS, AUTH_ERRORS } from "@/lib/authorization";

// ─── Auth helper ──────────────────────────────────────────────────────────────
// Admin/owner only — see the matching note in [id]/route.js. Any STAFF
// account could otherwise list every rental applicant's contact info,
// commission ask, and message.

async function requireAuth() {
  const session = await auth();
  if (!session?.user) return { error: unauthorized(AUTH_ERRORS.NOT_AUTHENTICATED) };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.RENTAL_REQUESTS)) {
    return { error: forbidden(AUTH_ERRORS.INSUFFICIENT_PERMISSIONS) };
  }
  return { session };
}

async function requireCustomerAuth() {
  const session = await auth();
  const authError = requireCustomer(session, unauthorized, forbidden);
  if (authError) return { error: authError };
  return { session };
}

// ─── GET /api/rental-requests ─────────────────────────────────────────────────
/**
 * Retrieves all rental requests with optional filtering.
 * 
 * Query parameters:
 *   ?status=PENDING|APPROVED|REJECTED|CANCELLED - filter by status
 *   ?includeDeleted=true - include soft-deleted requests
 * 
 * Responses:
 *   200 - list of rental requests
 *   401 - not authenticated
 *   403 - insufficient role
 *   500 - unexpected server error
 */
export async function GET(request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const includeDeleted = searchParams.get("includeDeleted") === "true";

    const where = {
      isDeleted: includeDeleted ? undefined : false,
    };

    if (status) {
      where.status = status;
    }

    const rentalRequests = await prisma.rentalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return ok(rentalRequests);
  } catch (error) {
    console.error("[GET /api/rental-requests]", error);
    return serverError();
  }
}

// ─── POST /api/rental-requests ────────────────────────────────────────────────
/**
 * Creates a new rental request. Only CUSTOMER users can submit rental requests.
 * 
 * Request body:
 * {
 *   rentalType: string,
 *   startDate: string (ISO date),
 *   endDate: string (ISO date),
 *   commissionType: "PERCENTAGE" | "FIXED" | "HYBRID",
 *   message?: string
 * }
 * 
 * Responses:
 *   201 - rental request created successfully
 *   400 - missing or malformed body
 *   401 - not authenticated
 *   403 - insufficient role (only CUSTOMER can submit)
 *   422 - validation errors
 *   500 - unexpected server error
 */
export async function POST(request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { error: authError,session } = await requireCustomerAuth();
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

  // ── Validate input ───────────────────────────────────────────────────────
  const validationResult = createRentalRequestSchema.safeParse(body);

  if (!validationResult.success) {
    const errors = validationResult.error.errors.map((err) => ({
      field: err.path.join("."),
      message: err.message,
    }));
    return badRequest("Validation échouée.", errors);
  }

  const { rentalType, startDate, endDate, commissionType, message } =
    validationResult.data;

  // ── Create rental request ────────────────────────────────────────────────
  try {
    const rentalRequest = await prisma.rentalRequest.create({
      data: {
        userId: session.user.id,
        rentalType,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        commissionType,
        status: "PENDING",
        message,
      },
    });

    return created(rentalRequest, "Demande de location créée avec succès.");
  } catch (error) {
    const mapped = prismaError(error);
    if (mapped) return mapped;
    console.error("[POST /api/rental-requests]", error);
    return serverError();
  }
}

// ─── OPTIONS /api/rental-requests ────────────────────────────────────────────
/**
 * Handle CORS preflight requests for public form submissions.
 */
export async function OPTIONS() {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}