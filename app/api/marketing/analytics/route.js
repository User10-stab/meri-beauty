import { ok } from "@/lib/api-response";
import { requireMarketingApi } from "@/lib/prospects/require-marketing";
import { isGaDataConfigured, getGaOverview } from "@/lib/analytics/ga-data";

// ─── GET /api/marketing/analytics — chiffres GA4 (28 derniers jours) ─────────
// Réservé OWNER/ADMIN via requireMarketingApi. Répond toujours 200 avec un
// payload explicite pour que la page affiche le bon état (non configuré,
// accès refusé, données) plutôt qu'une erreur brute.
export async function GET() {
  const { error: authError } = await requireMarketingApi();
  if (authError) return authError;

  if (!isGaDataConfigured()) {
    return ok({ configured: false, overview: null, error: null }, "Google Analytics Data API non configurée.");
  }

  try {
    const overview = await getGaOverview();
    return ok({ configured: true, overview, error: null }, "Statistiques Google Analytics.");
  } catch (error) {
    console.error("[GET /api/marketing/analytics]", error?.code ?? error?.message ?? error);
    return ok(
      { configured: true, overview: null, error: error?.code ?? "GA_DATA_ERROR" },
      "Lecture des statistiques impossible pour le moment."
    );
  }
}

export async function OPTIONS() {
  return ok({}, "");
}
