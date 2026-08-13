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
import { getAppBaseUrl } from "@/lib/site-url";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-templates";
import {
  createNotificationsBulk,
  buildRentalRequestSubmittedNotification,
  getRentalRequestNotificationRecipients,
} from "@/lib/notifications";

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

  const { rentalType, startDate, endDate, commissionType, specialty, vatNumber, message } =
    validationResult.data;

  // ── Create rental request ────────────────────────────────────────────────
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Update the account's VAT number, and drop the verification proof
      // whenever the number actually changes.
      //
      // This used to write `vatNumber` on its own. User.vatNumber is paired
      // with vatValidatedAt / vatValidationName / vatValidationAddress, set
      // by the VIES lookup at signup — and lib/tax-policy.js#hasRecentVatValidation
      // reads vatValidatedAt to decide whether a sale qualifies for
      // reverse-charge. Replacing the number while leaving the old timestamp
      // in place made a never-verified number look verified, on real invoices.
      // No malice needed: correcting a typo here was enough to inherit the
      // previous number's verification.
      //
      // Clearing rather than re-verifying is deliberate — this endpoint is a
      // lead form, and a VIES outage must not cost Marie a rental enquiry.
      // The number is format-checked by the schema; re-verification belongs
      // where the contract is signed.
      if (vatNumber && session.user.id) {
        const current = await tx.user.findUnique({
          where: { id: session.user.id },
          select: { vatNumber: true },
        });

        if (current?.vatNumber !== vatNumber) {
          await tx.user.update({
            where: { id: session.user.id },
            data: {
              vatNumber,
              vatValidatedAt: null,
              vatValidationName: null,
              vatValidationAddress: null,
            },
          });
        }
      }

      const rentalRequest = await tx.rentalRequest.create({
        data: {
          // Connect via the relation — userId is the FK, Prisma wants
          // either `connect` or the scalar field name (`userId`).
          // The model declares `user User? @relation(...)` so both work,
          // but `connect` is the idiomatic form and avoids any ambiguity.
          user: session.user.id
            ? { connect: { id: session.user.id } }
            : undefined,
          rentalType,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
          commissionType,
          specialty,
          // vatNumber is NOT a field on RentalRequest — it only exists on
          // User and is already persisted in the tx.user.update() call above.
          status: "PENDING",
          message,
        },
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
        },
      });

      return { rentalRequest };
    });

    // Notify dashboard users about the new rental request (outside transaction - business operation already committed)
    const recipientUserIds = await getRentalRequestNotificationRecipients();

    if (recipientUserIds.length > 0) {
      try {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildRentalRequestSubmittedNotification({
              userId: uid,
              rentalRequestId: result.rentalRequest.id,
              rentalType: result.rentalRequest.rentalType,
              applicantName: result.rentalRequest.user?.fullName,
            })
          )
        );
      } catch (err) {
        if (err?.message === "VALIDATION_ERROR") {
          console.error("[POST /api/rental-requests] notification validation error:", err.fieldErrors);
        } else {
          console.error("[POST /api/rental-requests] notifications failed:", err);
        }
      }
    }

    // Send email to admin/owner about the new rental request
    const admins = await prisma.user.findMany({
      where: { role: { in: ["OWNER", "ADMIN"] } },
      select: { email: true },
    });

    for (const admin of admins) {
      if (admin.email) {
        await sendEmail({
          to: admin.email,
          subject: "Nouvelle demande de location – Meri Beauty",
          text: `Bonjour,\n\nUne nouvelle demande de location a été soumise.\n\nType: ${result.rentalRequest.rentalType}\nDate de début: ${new Date(result.rentalRequest.startDate).toLocaleDateString("fr-FR")}\n${result.rentalRequest.endDate ? `Date de fin: ${new Date(result.rentalRequest.endDate).toLocaleDateString("fr-FR")}\n` : ""}Type de commission: ${result.rentalRequest.commissionType}\n\nMessage: ${result.rentalRequest.message || "Aucun message"}\n\nVeuillez consulter le tableau de bord pour traiter cette demande.\n\nL'équipe Meri Beauty`,
          html: `<p>Bonjour,</p><p>Une nouvelle demande de location a été soumise.</p><p><strong>Type:</strong> ${escapeHtml(result.rentalRequest.rentalType)}<br><strong>Date de début:</strong> ${new Date(result.rentalRequest.startDate).toLocaleDateString("fr-FR")}${result.rentalRequest.endDate ? `<br><strong>Date de fin:</strong> ${new Date(result.rentalRequest.endDate).toLocaleDateString("fr-FR")}` : ""}<br><strong>Type de commission:</strong> ${escapeHtml(result.rentalRequest.commissionType)}</p><p><strong>Message:</strong> ${escapeHtml(result.rentalRequest.message || "Aucun message")}</p><p>Veuillez consulter le tableau de bord pour traiter cette demande.</p><p>L'équipe Meri Beauty</p>`,
        }).catch((err) => console.error("[POST /api/rental-requests] admin email failed:", err));
      }
    }

    return created(result.rentalRequest, "Demande de location créée avec succès.");
  } catch (error) {
    const mapped = prismaError(error);
    if (mapped) return mapped;
    console.error("[POST /api/rental-requests]", error);
    return serverError();
  }
}

// ─── OPTIONS /api/rental-requests ────────────────────────────────────────────
/**
 * CORS preflight — this endpoint is only ever called from this same site's
 * own rental-request form, never cross-origin, so the allowed origin is
 * scoped to our own domain rather than "*". POST is auth-gated regardless
 * (a wildcard origin can't carry credentials anyway), but a wildcard here
 * was still a misconfiguration worth closing.
 */
export async function OPTIONS() {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set('Access-Control-Allow-Origin', getAppBaseUrl());
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}