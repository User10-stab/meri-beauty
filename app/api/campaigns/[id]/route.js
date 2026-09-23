import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError, prismaError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { isValidSegment } from "@/lib/campaigns/segments";
import { unlink } from "fs/promises";
import path from "path";

// ─── GET /api/campaigns/:id — détail + stats ─────────────────────────────────
export async function GET(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) return notFound("Campagne introuvable.");

    return ok(
      {
        ...campaign,
        openRate: campaign.totalSenders > 0 ? Math.round((campaign.openedCount / campaign.totalSenders) * 1000) / 10 : 0,
        clickRate: campaign.totalSenders > 0 ? Math.round((campaign.clickedCount / campaign.totalSenders) * 1000) / 10 : 0,
      },
      "Campagne récupérée."
    );
  } catch (error) {
    console.error("[GET /api/campaigns/:id]", error);
    return serverError();
  }
}

// ─── PUT /api/campaigns/:id — édition (brouillon/planifiée uniquement) ───────
export async function PUT(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const existing = await prisma.campaign.findUnique({ where: { id }, select: { status: true } });
    if (!existing) return notFound("Campagne introuvable.");
    if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
      return badRequest("Une campagne envoyée ou annulée ne peut plus être modifiée.");
    }

    const body = await request.json();
    const data = {};
    for (const field of ["title", "subject", "preheader", "content", "imageUrl", "attachmentUrl", "ctaText", "ctaUrl", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"]) {
      if (body?.[field] !== undefined) data[field] = body[field] === "" ? null : body[field];
    }
    if (body?.targetSegment !== undefined && isValidSegment(body.targetSegment)) {
      data.targetSegment = body.targetSegment;
    }
    if (body?.status !== undefined) {
      if (!["DRAFT", "SCHEDULED", "CANCELLED"].includes(body.status)) {
        return badRequest("Statut invalide.");
      }
      data.status = body.status;
    }
    if (body?.scheduledDate !== undefined) {
      data.scheduledDate = body.scheduledDate ? new Date(body.scheduledDate) : null;
    }

    const updated = await prisma.campaign.update({ where: { id }, data });
    return ok(updated, "Campagne mise à jour.");
  } catch (error) {
    console.error("[PUT /api/campaigns/:id]", error);
    return prismaError(error) || serverError();
  }
}

// ─── DELETE /api/campaigns/:id ──────────────────────────────────────────────
// Refusée si déjà envoyée (historique d'audit : clics, ouvertures,
// activités). Le fichier joint local est supprimé du disque en bonus.
export async function DELETE(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const existing = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true, attachmentUrl: true },
    });
    if (!existing) return notFound("Campagne introuvable.");
    if (existing.status === "SENT") {
      return badRequest("Une campagne envoyée ne peut pas être supprimée (historique conservé). Annulez une planifiée ou supprimez un brouillon.");
    }

    await prisma.campaign.delete({ where: { id } });

    // Ménage disque : pièce jointe locale confinée à /uploads/campaigns.
    try {
      const url = String(existing.attachmentUrl || "");
      if (url.startsWith("/uploads/campaigns/")) {
        const fileName = path.basename(url.split("?")[0]);
        if (fileName && !fileName.includes("..")) {
          const root = path.join(process.cwd(), "public", "uploads", "campaigns");
          const resolved = path.resolve(root, fileName);
          if (!path.relative(root, resolved).startsWith("..")) {
            await unlink(resolved);
          }
        }
      }
    } catch {
      // Fichier déjà absent ou illisible — la campagne est supprimée quand même.
    }

    return ok({ id }, "Campagne supprimée.");
  } catch (error) {
    console.error("[DELETE /api/campaigns/:id]", error);
    return prismaError(error) || serverError();
  }
}
