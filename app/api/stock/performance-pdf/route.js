import { NextResponse } from "next/server";
import { getProductPerformanceReport } from "@/actions/boutique/stock";
import { applyExportView } from "@/lib/stock/performance-filters";
import { renderProductPerformancePdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout of « Performance par produit » as currently shown —
 * same period handling and view filters as ../performance-export/route.js.
 * `inline`: opens in the browser's own PDF viewer, which prints properly.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getProductPerformanceReport({
    months: searchParams.get("mois") || undefined,
    from: searchParams.get("du") || undefined,
    to: searchParams.get("au") || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Impression indisponible." }, { status: 403 });
  }

  const view = applyExportView(result.data, searchParams);
  const pdf = await renderProductPerformancePdf({ report: result.data, ...view });
  const { from, to } = result.data.filters;
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="performance-produits-${from}_${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
