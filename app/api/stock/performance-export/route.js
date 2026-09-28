import { NextResponse } from "next/server";
import { getProductPerformanceReport } from "@/actions/boutique/stock";
import { applyExportView } from "@/lib/stock/performance-filters";
import { buildProductPerformanceWorkbook } from "@/lib/stock/performance-excel";

export const runtime = "nodejs";

/**
 * Protected Excel download of « Performance par produit » as currently shown:
 * the period (?mois= or ?du=&au=) goes through the permission-checked server
 * action exactly like the page; the search / verdict / sort view (?q=,
 * ?verdict=, ?tri=, ?ordre=) is then applied to its rows, so the file is the
 * list on screen — same as the page's CSV.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getProductPerformanceReport({
    months: searchParams.get("mois") || undefined,
    from: searchParams.get("du") || undefined,
    to: searchParams.get("au") || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const view = applyExportView(result.data, searchParams);
  const workbook = await buildProductPerformanceWorkbook({ report: result.data, ...view });
  const { from, to } = result.data.filters;
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="performance-produits-${from}_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
