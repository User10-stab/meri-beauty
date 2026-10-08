import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError, prismaError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { normalizeEmail, splitFullName, buildFullName } from "@/lib/prospects/prospect-service";
import { buildTimeline, buildCampaignEngagement, TIMELINE_LIMIT } from "@/lib/prospects/timeline";

// ─── GET /api/prospects/:id — prospect + timeline fusionnée + engagement ─────
export async function GET(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const prospect = await prisma.prospect.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true, role: true, createdAt: true } },
        lastCampaign: { select: { id: true, title: true, subject: true, status: true, sentAt: true } },
      },
    });
    if (!prospect) return notFound("Prospect introuvable.");

    // Timeline fusionnée : activités + ouvertures + clics, triée desc.
    const [activities, openings, clicks] = await Promise.all([
      prisma.prospectActivity.findMany({
        where: { prospectId: id },
        orderBy: { createdAt: "desc" },
        take: TIMELINE_LIMIT,
        include: { campaign: { select: { id: true, title: true } } },
      }),
      prisma.mailOpening.findMany({
        where: { email: prospect.email },
        orderBy: { openedAt: "desc" },
        take: TIMELINE_LIMIT,
        include: { campaign: { select: { id: true, title: true } } },
      }),
      prisma.campaignClick.findMany({
        where: { email: prospect.email },
        orderBy: { clickedAt: "desc" },
        take: TIMELINE_LIMIT,
        include: { campaign: { select: { id: true, title: true } } },
      }),
    ]);

    const timeline = buildTimeline({ activities, openings, clicks });

    // Engagement par campagne (ouvertures + clics groupés).
    const campaignEngagement = buildCampaignEngagement({ openings, clicks });

    return ok({ prospect, timeline, campaignEngagement }, "Prospect récupéré.");
  } catch (error) {
    console.error("[GET /api/prospects/:id]", error);
    return serverError();
  }
}

// ─── PUT /api/prospects/:id — édition fiche ──────────────────────────────────
export async function PUT(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    const current = await prisma.prospect.findUnique({ where: { id } });
    if (!current) return notFound("Prospect introuvable.");

    const data = {};
    for (const field of ["phone", "company", "city", "region", "website", "country", "notes"]) {
      if (body?.[field] !== undefined) {
        data[field] = body[field] === "" ? null : body[field];
      }
    }
    // Noms : fullName canonique + first/last historiques gardés synchronisés.
    // - fullName fourni -> fait foi ; first/last dérivés seulement si
    //   l'admin ne les a pas saisis explicitement ;
    // - sinon first/last fournis -> fullName reconstruit (sauf s'il existe
    //   déjà et que les deux noms deviennent vides : on le conserve).
    if (body?.fullName !== undefined || body?.firstName !== undefined || body?.lastName !== undefined) {
      if (body?.fullName !== undefined) {
        const nextFull = body.fullName === "" ? null : body.fullName;
        data.fullName = nextFull;
        if (body?.firstName === undefined && body?.lastName === undefined && nextFull) {
          const split = splitFullName(nextFull);
          data.firstName = split.firstName;
          data.lastName = split.lastName;
        } else {
          if (body?.firstName !== undefined) data.firstName = body.firstName === "" ? null : body.firstName;
          if (body?.lastName !== undefined) data.lastName = body.lastName === "" ? null : body.lastName;
        }
      } else {
        const nextFirst = body?.firstName !== undefined
          ? (body.firstName === "" ? null : body.firstName)
          : current.firstName;
        const nextLast = body?.lastName !== undefined
          ? (body.lastName === "" ? null : body.lastName)
          : current.lastName;
        if (body?.firstName !== undefined) data.firstName = nextFirst;
        if (body?.lastName !== undefined) data.lastName = nextLast;
        const rebuilt = buildFullName(nextFirst, nextLast, null);
        data.fullName = rebuilt ?? current.fullName;
      }
    }
    if (body?.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!email.includes("@")) return badRequest("E-mail invalide.", { email: "E-mail invalide." });
      data.email = email;
    }
    if (body?.source !== undefined) data.source = body.source;

    const updated = await prisma.prospect.update({ where: { id }, data });
    return ok(updated, "Prospect mis à jour.");
  } catch (error) {
    console.error("[PUT /api/prospects/:id]", error);
    return prismaError(error) || serverError();
  }
}

// ─── DELETE /api/prospects/:id (+ activités liées) ───────────────────────────
export async function DELETE(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    await prisma.prospectActivity.deleteMany({ where: { prospectId: id } });
    await prisma.prospect.delete({ where: { id } });
    return ok({ id }, "Prospect supprimé.");
  } catch (error) {
    console.error("[DELETE /api/prospects/:id]", error);
    return prismaError(error) || serverError();
  }
}
