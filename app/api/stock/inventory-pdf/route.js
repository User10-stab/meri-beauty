import { NextResponse } from "next/server";
import { getInventorySnapshot } from "@/actions/boutique/stock";
import { renderInventorySnapshotPdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout of the current stock state — the "état du stock" a
 * stock controller can be handed as standalone proof, styled like every
 * other dashboard export (see ../../recettes/pdf/route.js).
 *
 * `inline`, not `attachment`: opens straight in the browser's own PDF
 * viewer, which already has real print/pagination.
 */
export async function GET() {
  const result = await getInventorySnapshot();

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Impression indisponible." }, { status: 403 });
  }

  const pdf = await renderInventorySnapshotPdf(result.data);
  const dateStr = new Date().toISOString().slice(0, 10);
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etat-du-stock-${dateStr}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
