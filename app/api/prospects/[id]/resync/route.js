import { ok, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { resyncProspect } from "@/lib/campaigns/send-campaign";

// ─── POST /api/prospects/:id/resync — recale le statut via l'activité salon ──
export async function POST(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const updated = await resyncProspect(id);
    if (!updated) return badRequest("Prospect introuvable.");
    return ok(updated, "Prospect resynchronisé avec l'activité du salon.");
  } catch (error) {
    console.error("[POST /api/prospects/:id/resync]", error);
    return serverError();
  }
}
