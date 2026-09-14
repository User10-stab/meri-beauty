import { NextResponse } from "next/server";
import { getCashBookLedger } from "@/actions/dashboard/cash-book";
import { renderCashBookPdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout for the currently displayed Livre de caisse — the
 * journal only (day-by-day entrées/sorties/solde), same range. Deliberately
 * NOT the inline "Rapport" section: the client wants the print to stay what
 * it always was for them — days and their values — the Rapport (category/VAT
 * breakdown, comparison, session detail) is a screen-only view. The action
 * repeats the CASH_REGISTER permission check and re-normalizes the window,
 * so a hand-edited URL cannot print a broader range than the screen permits —
 * same guarantee as the Excel export at ../export/route.js and the Livre de
 * recettes' own PDF route.
 *
 * `inline`, not `attachment`: opens straight in the browser's own PDF
 * viewer, which has real pagination — this replaces the old window.print()
 * of the dashboard screen, which had none.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filterInput = {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
  };

  const ledger = await getCashBookLedger(filterInput);

  if (!ledger.success) {
    return NextResponse.json({ error: ledger.message ?? "Impression indisponible." }, { status: 403 });
  }

  const pdf = await renderCashBookPdf({ ledger: ledger.data });
  const { from, to } = ledger.data.filters;
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="livre-de-caisse-${from}_${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
