import { NextResponse } from "next/server";
import { getReportsData } from "@/actions/dashboard/get-reports-data";
import { normalizeReportMonths } from "@/lib/reports-filters";
import { buildReportsWorkbook } from "@/lib/reports-excel";

export const runtime = "nodejs";

/**
 * Protected Excel download for the currently displayed reports view. The
 * server action repeats the dashboard-role and staff-filter checks, so an
 * edited URL cannot export a broader data set than the screen permits.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const months = normalizeReportMonths(searchParams.get("months"));
  const staffId = searchParams.get("staffId") || null;
  const result = await getReportsData({ months, staffId });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const workbook = await buildReportsWorkbook(result.data);
  const scope = result.data.filters.staffId ? "-praticienne" : "";
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rapport-meri-beauty-${result.data.filters.months}-mois${scope}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
