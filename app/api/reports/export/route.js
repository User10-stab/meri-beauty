import { NextResponse } from "next/server";
import { getReportsData } from "@/actions/dashboard/get-reports-data";
import { normalizeReportMonths } from "@/lib/reports-filters";
import { buildReportsWorkbook } from "@/lib/reports-excel";

export const runtime = "nodejs";

/**
 * Protected Excel download for the currently displayed reports view. The
 * server action repeats the dashboard-role check and the salon-only scope, so
 * an edited URL cannot export a broader data set than the screen permits.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const months = normalizeReportMonths(searchParams.get("months"));
  const result = await getReportsData({ months });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const workbook = await buildReportsWorkbook(result.data);
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rapport-meri-beauty-${result.data.filters.months}-mois.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
