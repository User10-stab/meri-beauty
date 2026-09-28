import { NextResponse } from "next/server";
import { getGestionReport } from "@/actions/dashboard/gestion";
import { buildGestionWorkbook } from "@/lib/gestion/gestion-excel";

export const runtime = "nodejs";

/**
 * Protected Excel download for the currently displayed Gestion report. The
 * server action repeats the OWNER/ADMIN check and re-normalizes the window,
 * so a hand-edited URL cannot export more than the screen permits — same
 * guarantee as ../../recettes/export/route.js.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getGestionReport({
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    category: searchParams.get("category") || undefined,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const workbook = await buildGestionWorkbook(result.data);
  const { from, to } = result.data.filters;
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="gestion-${from}_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
