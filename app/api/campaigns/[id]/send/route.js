import { ok, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { sendCampaign, claimScheduledCampaign } from "@/lib/campaigns/send-campaign";
import { prisma } from "@/lib/prisma";

// ─── POST /api/campaigns/:id/send — envoi immédiat ───────────────────────────
export async function POST(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    // Campagne planifiée ARRIVÉE à échéance : claim anti double-envoi avec
    // le cron (qui peut la prendre au même moment). Perdu -> le cron
    // s'en charge. Une planifiée FUTURE s'envoie directement (forçage).
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true, scheduledDate: true },
    });
    if (
      campaign?.status === "SCHEDULED" &&
      campaign.scheduledDate &&
      campaign.scheduledDate <= new Date() &&
      !(await claimScheduledCampaign(id))
    ) {
      return ok(
        { success: true, skipped: true },
        "Envoi déjà pris en charge par la planification automatique."
      );
    }
    const result = await sendCampaign(id, { triggeredBy: "manual" });
    if (!result.success) return ok(result, result.message);
    return ok(result, result.message);
  } catch (error) {
    console.error("[POST /api/campaigns/:id/send]", error);
    return serverError();
  }
}
