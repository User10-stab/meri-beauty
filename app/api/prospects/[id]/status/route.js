import { ok, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { setStatus, PROSPECT_STATUSES } from "@/lib/prospects/prospect-service";

// ─── PATCH /api/prospects/:id/status — changement de statut explicite ────────
export async function PATCH(request, { params }) {
  const { error: authError, session } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const status = body?.status;

    if (!PROSPECT_STATUSES.includes(status)) {
      return badRequest("Statut invalide.", { status: `Attendu : ${PROSPECT_STATUSES.join(", ")}` });
    }

    const updated = await setStatus(id, status, { note: body?.note ?? null, byUserId: session.user.id });
    if (!updated) return badRequest("Prospect introuvable.");
    return ok(updated, "Statut mis à jour.");
  } catch (error) {
    console.error("[PATCH /api/prospects/:id/status]", error);
    return serverError();
  }
}
