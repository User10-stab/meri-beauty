import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { isValidSegment } from "@/lib/campaigns/segments";

// ─── GET /api/campaigns — liste + taux d'ouverture/clic ──────────────────────
export async function GET() {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const data = campaigns.map((c) => ({
      ...c,
      openRate: c.totalSenders > 0 ? Math.round((c.openedCount / c.totalSenders) * 1000) / 10 : 0,
      clickRate: c.totalSenders > 0 ? Math.round((c.clickedCount / c.totalSenders) * 1000) / 10 : 0,
    }));

    return ok(data, "Campagnes récupérées.");
  } catch (error) {
    console.error("[GET /api/campaigns]", error);
    return serverError();
  }
}

// ─── POST /api/campaigns — création (brouillon) ──────────────────────────────
export async function POST(request) {
  const { error: authError, session } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const body = await request.json();
    const title = String(body?.title || "").trim();
    const subject = String(body?.subject || "").trim();
    const content = String(body?.content || "").trim();

    const errors = {};
    if (!title) errors.title = "Le titre est requis.";
    if (!subject) errors.subject = "L'objet est requis.";
    if (!content) errors.content = "Le contenu est requis.";
    if (Object.keys(errors).length > 0) {
      return badRequest("Veuillez corriger les erreurs.", errors);
    }

    const campaign = await prisma.campaign.create({
      data: {
        title,
        subject,
        preheader: body?.preheader?.trim() || null,
        content,
        imageUrl: body?.imageUrl?.trim() || null,
        attachmentUrl: body?.attachmentUrl?.trim() || null,
        targetSegment: isValidSegment(body?.targetSegment) ? body.targetSegment : "newsletter",
        ctaText: body?.ctaText?.trim() || null,
        ctaUrl: body?.ctaUrl?.trim() || null,
        utmSource: body?.utmSource?.trim() || "email",
        utmMedium: body?.utmMedium?.trim() || "email",
        utmCampaign: body?.utmCampaign?.trim() || null,
        utmContent: body?.utmContent?.trim() || null,
        utmTerm: body?.utmTerm?.trim() || null,
        status: "DRAFT",
        scheduledDate: body?.scheduledDate ? new Date(body.scheduledDate) : null,
        createdById: session.user.id,
      },
    });

    return created(campaign, "Campagne créée.");
  } catch (error) {
    console.error("[POST /api/campaigns]", error);
    return serverError();
  }
}
