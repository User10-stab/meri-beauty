import { ok, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { getSegmentRecipients, isValidSegment } from "@/lib/campaigns/segments";

// ─── GET /api/campaigns/segment-emails/:segment — prévisualisation ───────────
export async function GET(request, { params }) {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { segment } = await params;
    if (!isValidSegment(segment)) return badRequest("Segment inconnu.");

    const recipients = await getSegmentRecipients(segment);
    return ok(
      { segment, count: recipients.length, emails: recipients.slice(0, 100).map((r) => r.email) },
      "Destinataires du segment."
    );
  } catch (error) {
    console.error("[GET /api/campaigns/segment-emails]", error);
    return serverError();
  }
}
