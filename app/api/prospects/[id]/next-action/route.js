import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError, prismaError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { addActivity } from "@/lib/prospects/prospect-service";

const NEXT_ACTIONS = [
  "envoyer_email",
  "relancer_email",
  "appeler",
  "envoyer_campagne",
  "proposer_demo",
  "suivre_essai",
  "autre",
  "aucune",
];

// ─── PATCH /api/prospects/:id/next-action — prochaine action ─────────────────
export async function PATCH(request, { params }) {
  const { error: authError, session } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    const type = body?.type ?? null;

    if (type !== null && !NEXT_ACTIONS.includes(type)) {
      return badRequest("Type d'action invalide.", { type: `Attendu : ${NEXT_ACTIONS.join(", ")}` });
    }

    const updated = await prisma.prospect.update({
      where: { id },
      data: {
        nextActionType: type,
        nextActionDueDate: body?.dueDate ? new Date(body.dueDate) : null,
        nextActionNote: body?.note ?? null,
      },
    });

    if (type && type !== "aucune") {
      await addActivity(updated, {
        type: "note_added",
        description: `Prochaine action : ${type}${body?.dueDate ? ` (échéance ${new Date(body.dueDate).toLocaleDateString("fr-BE")})` : ""}${body?.note ? ` — ${body.note}` : ""}`,
        createdBy: session.user.id,
      });
    }

    return ok(updated, "Prochaine action mise à jour.");
  } catch (error) {
    console.error("[PATCH /api/prospects/:id/next-action]", error);
    return prismaError(error) || serverError();
  }
}
