import { NextResponse } from "next/server";
import { cashBookFileBaseName } from "@/lib/cash-book/filters";
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
    type: searchParams.get("type") || undefined,
  };

  const [ledger, report] = await Promise.all([getCashBookLedger(filterInput), getCashReport(filterInput)]);

  if (!ledger.success) {
    return NextResponse.json({ error: ledger.message ?? "Export indisponible." }, { status: 403 });
  }

  const workbook = await buildCashBookWorkbook({
    ledger: ledger.data,
    // The Rapport is about cash sales — with the apports/dépenses filter on,
    // sales are hidden, so the workbook carries the filtered journal alone.
    report: report.success && !ledger.data.filters.type ? report.data : null,
  });
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${cashBookFileBaseName(ledger.data.filters)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
