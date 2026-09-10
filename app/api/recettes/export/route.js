import { NextResponse } from "next/server";
import { getRecettesJournal } from "@/actions/dashboard/get-recettes-journal";
import { buildRecettesWorkbook } from "@/lib/recettes-excel";

export const runtime = "nodejs";

/**
 * Protected Excel download for the currently displayed Livre de recettes.
 * The server action repeats the OWNER/ADMIN check and re-normalizes the
 * window, so a hand-edited URL cannot export a broader range than the
 * screen permits.
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
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const workbook = await buildRecettesWorkbook(result.data);
  const { from, to } = result.data.filters;
  return new NextResponse(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="livre-de-recettes-${from}_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
