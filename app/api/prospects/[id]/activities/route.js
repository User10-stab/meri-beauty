import { created, badRequest, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { addActivity } from "@/lib/prospects/prospect-service";

const MANUAL_TYPES = ["note_added", "manual_contact", "call", "other"];

// ─── POST /api/prospects/:id/activities — note / contact manuel ──────────────
export async function POST(request, { params }) {
  const { error: authError, session } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const type = MANUAL_TYPES.includes(body?.type) ? body.type : "note_added";
    const description = String(body?.description || "").trim();
    if (!description) {
      return badRequest("Une description est requise.", { description: "Description requise." });
    }

    const activity = await addActivity(id, {
      type,
      description,
      metadata: body?.metadata ?? null,
      createdBy: session.user.id,
    });
    if (!activity) return badRequest("Prospect introuvable.");
    return created(activity, "Activité ajoutée.");
  } catch (error) {
    console.error("[POST /api/prospects/:id/activities]", error);
    return serverError();
  }
}
