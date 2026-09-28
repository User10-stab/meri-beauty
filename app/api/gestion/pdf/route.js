import { NextResponse } from "next/server";
import { getGestionReport } from "@/actions/dashboard/gestion";
import { renderGestionPdf } from "@/lib/pdf/render";

// react-pdf needs Node APIs (it reads the logo PNG off disk) — not edge-compatible.
export const runtime = "nodejs";

/**
 * Protected PDF printout for the currently displayed Gestion report. The
 * server action repeats the OWNER/ADMIN check and re-normalizes the window —
 * same guarantee as ../export/route.js. `inline`: opens in the browser's own
 * PDF viewer, which has real print and pagination.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getGestionReport({
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    category: searchParams.get("category") || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Impression indisponible." }, { status: 403 });
  }

  const pdf = await renderGestionPdf(result.data);
  const { from, to } = result.data.filters;
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="gestion-${from}_${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
