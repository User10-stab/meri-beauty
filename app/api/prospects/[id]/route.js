import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError, prismaError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { normalizeEmail } from "@/lib/prospects/prospect-service";

const TIMELINE_LIMIT = 200;

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

    const timeline = [
      ...activities.map((a) => ({
        kind: "activity",
        type: a.type,
        date: a.createdAt,
        description: a.description,
        campaign: a.campaign,
        metadata: a.metadata,
        id: `a-${a.id}`,
      })),
      ...openings.map((o) => ({
        kind: "open",
        type: "email_opened",
        date: o.openedAt,
        description: `E-mail ouvert${o.campaign ? ` — ${o.campaign.title}` : ""}`,
        campaign: o.campaign,
        id: `o-${o.id}`,
      })),
      ...clicks.map((c) => ({
        kind: "click",
        type: "email_clicked",
        date: c.clickedAt,
        description: `Lien cliqué${c.campaign ? ` — ${c.campaign.title}` : ""}`,
        campaign: c.campaign,
        metadata: c.ctaUrl ? { url: c.ctaUrl } : null,
        id: `c-${c.id}`,
      })),
    ]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, TIMELINE_LIMIT);

    // Engagement par campagne (ouvertures + clics groupés).
    const engagementMap = new Map();
    for (const o of openings) {
      const key = o.campaignId || "hors-campagne";
      const entry = engagementMap.get(key) || { campaign: o.campaign, opens: 0, clicks: 0 };
      entry.opens += 1;
      engagementMap.set(key, entry);
    }
    for (const c of clicks) {
      const key = c.campaignId || "hors-campagne";
      const entry = engagementMap.get(key) || { campaign: c.campaign, opens: 0, clicks: 0 };
      entry.clicks += 1;
      engagementMap.set(key, entry);
    }
    const campaignEngagement = [...engagementMap.values()];

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

    const data = {};
    for (const field of ["firstName", "lastName", "phone", "company", "city", "website", "country", "notes"]) {
      if (body?.[field] !== undefined) {
        data[field] = body[field] === "" ? null : body[field];
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
