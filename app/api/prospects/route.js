import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import {
  createProspect,
  normalizeEmail,
  normalizeSource,
  isValidSource,
  sanitizeUtm,
  PROSPECT_STATUSES,
} from "@/lib/prospects/prospect-service";

const SORTABLE_FIELDS = new Set(["createdAt", "updatedAt", "lastActivityAt", "email", "status"]);

// ─── GET /api/prospects?search&status&source&sortBy&sortOrder&page&limit ──────
export async function GET(request) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") || "").trim();
    const status = searchParams.get("status");
    const source = searchParams.get("source");
    const sortBy = SORTABLE_FIELDS.has(searchParams.get("sortBy")) ? searchParams.get("sortBy") : "createdAt";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const where = {};
    if (status && PROSPECT_STATUSES.includes(status)) where.status = status;
    if (source && isValidSource(source)) where.source = source;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, prospects] = await Promise.all([
      prisma.prospect.count({ where }),
      prisma.prospect.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { activities: true } },
        },
      }),
    ]);

    return ok(
      {
        prospects,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
      "Prospects récupérés."
    );
  } catch (error) {
    console.error("[GET /api/prospects]", error);
    return serverError();
  }
}

// ─── POST /api/prospects (admin — création manuelle) ─────────────────────────
export async function POST(request) {
  const { error: authError, session } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    if (!email || !email.includes("@")) {
      return badRequest("Une adresse e-mail valide est requise.", { email: "E-mail invalide." });
    }

    const utm = sanitizeUtm(body?.utm);
    const source = body?.source
      ? (isValidSource(body.source) ? body.source : normalizeSource(body.source))
      : normalizeSource(utm.utmSource);
    const prospect = await createProspect({
      email,
      firstName: body?.firstName,
      lastName: body?.lastName,
      phone: body?.phone,
      company: body?.company,
      city: body?.city,
      website: body?.website,
      country: body?.country,
      source,
      utm,
      userId: body?.userId ?? null,
      createdBy: session.user.id,
    });

    if (!prospect) return badRequest("Création impossible pour cet e-mail.");
    return created(prospect, "Prospect créé.");
  } catch (error) {
    console.error("[POST /api/prospects]", error);
    return serverError();
  }
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
