import { ok, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { sendCampaign } from "@/lib/campaigns/send-campaign";

// ─── POST /api/campaigns/:id/send — envoi immédiat ───────────────────────────
export async function POST(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const result = await sendCampaign(id, { triggeredBy: "manual" });
    if (!result.success) return ok(result, result.message);
    return ok(result, result.message);
  } catch (error) {
    console.error("[POST /api/campaigns/:id/send]", error);
    return serverError();
  }
}
