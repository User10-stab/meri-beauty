import { NextResponse } from "next/server";
import { getStockMovementsReport } from "@/actions/boutique/stock";
import { renderStockMovementsPdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout for the currently displayed Mouvements de stock
 * ledger — the audit trail a stock controller can be handed, including every
 * ADJUSTMENT. The server action re-checks permissions and re-normalizes the
 * window, so a hand-edited URL cannot print a broader range than the screen
 * permits — same guarantee as ../../recettes/pdf/route.js.
 *
 * `inline`, not `attachment`: opens straight in the browser's own PDF
 * viewer, which already has real print/pagination.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getStockMovementsReport({
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    type: searchParams.get("type") || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Impression indisponible." }, { status: 403 });
  }

  const pdf = await renderStockMovementsPdf(result.data);
  const { from, to } = result.data.filters;
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="mouvements-de-stock-${from}_${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
