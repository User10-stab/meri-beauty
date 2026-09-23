import { ok, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { getAudienceCounts, SEGMENTS } from "@/lib/campaigns/segments";

// ─── GET /api/campaigns/audience-counts — compteurs par segment ──────────────
export async function GET() {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const counts = await getAudienceCounts();
    return ok({ segments: SEGMENTS, counts }, "Compteurs d'audience.");
  } catch (error) {
    console.error("[GET /api/campaigns/audience-counts]", error);
    return serverError();
  }
}
