import { NextResponse } from "next/server";
import { getRecettesJournal } from "@/actions/dashboard/get-recettes-journal";
import { renderRecettesJournalPdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout for the currently displayed Livre de recettes.
 * The server action repeats the OWNER/ADMIN check and re-normalizes the
 * window, so a hand-edited URL cannot print a broader range than the screen
 * permits — same guarantee as the Excel export at ../export/route.js.
 *
 * `inline`, not `attachment`: opens straight in the browser's own PDF
 * viewer, which already has a real print function with real pagination —
 * the whole reason this replaced the old window.print() button.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getRecettesJournal({
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    method: searchParams.get("method") || undefined,
    category: searchParams.get("category") || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Impression indisponible." }, { status: 403 });
  }

  const pdf = await renderRecettesJournalPdf(result.data);
  const { from, to } = result.data.filters;
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="livre-de-recettes-${from}_${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
