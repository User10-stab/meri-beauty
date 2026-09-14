import { NextResponse } from "next/server";
import { getInventorySnapshot } from "@/actions/boutique/stock";
import { renderInventorySnapshotPdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout of the stock state — the "état du stock" a stock
 * controller can be handed as standalone proof, styled like every other
 * dashboard export (see ../../recettes/pdf/route.js).
 *
 * An optional `?asOf=YYYY-MM-DD` reconstructs the same document for a past
 * day instead of right now — see lib/stock/build-inventory-snapshot.js for
 * how that reconstruction works and what it can't recover (réservé/dispo).
 *
 * `inline`, not `attachment`: opens straight in the browser's own PDF
 * viewer, which already has real print/pagination.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const asOf = searchParams.get("asOf") ?? undefined;

  const result = await getInventorySnapshot({ asOf });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Impression indisponible." }, { status: 403 });
  }

  const pdf = await renderInventorySnapshotPdf(result.data);
  const dateStr = result.data.isHistorical
    ? result.data.asOf.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etat-du-stock-${dateStr}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
