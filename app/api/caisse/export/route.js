import { NextResponse } from "next/server";
import { getCashBookLedger, getCashReport } from "@/actions/dashboard/cash-book";
import { buildCashBookWorkbook } from "@/lib/cash-book-excel";

export const runtime = "nodejs";

/**
 * Protected Excel download for the currently displayed Livre de caisse —
 * journal + inline Rapport, same range. Both actions repeat the
 * CASH_REGISTER permission check and re-normalize the window, so a
 * hand-edited URL cannot export a broader range than the screen permits.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filterInput = {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
  };

  const [ledger, report] = await Promise.all([getCashBookLedger(filterInput), getCashReport(filterInput)]);

  if (!ledger.success) {
    return NextResponse.json({ error: ledger.message ?? "Export indisponible." }, { status: 403 });
  }

  const workbook = await buildCashBookWorkbook({
    ledger: ledger.data,
    report: report.success ? report.data : null,
  });
  const { from, to } = ledger.data.filters;
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="livre-de-caisse-${from}_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
