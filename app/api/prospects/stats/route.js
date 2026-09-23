import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";

// ─── GET /api/prospects/stats — agrégats $group by status (+ source) ─────────
export async function GET() {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  try {
    const [byStatus, bySource, total, optOuts, overdueActions] = await Promise.all([
      prisma.prospect.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.prospect.groupBy({ by: ["source"], _count: { _all: true } }),
      prisma.prospect.count(),
      prisma.prospect.count({ where: { marketingOptOut: true } }),
      prisma.prospect.count({
        where: {
          nextActionType: { not: null },
          nextActionDueDate: { lt: new Date() },
        },
      }),
    ]);

    return ok(
      {
        total,
        optOuts,
        overdueActions,
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
      },
      "Statistiques prospects."
    );
  } catch (error) {
    console.error("[GET /api/prospects/stats]", error);
    return serverError();
  }
}
