import { NextResponse } from "next/server";
import { getInvoicesExport } from "@/actions/dashboard/invoices";
import { invoiceFiltersFromSearchParams, invoiceExportFilename } from "@/lib/invoices/export-params";
import { buildInvoicesWorkbook } from "@/lib/invoices/invoices-excel";

export const runtime = "nodejs";

/**
 * Protected Excel export of the Factures list for the filters on screen. The
 * server action repeats the admin check and re-normalizes the filters, so a
 * hand-edited URL cannot export more than the page permits.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getInvoicesExport(invoiceFiltersFromSearchParams(searchParams));
  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const body = await buildInvoicesWorkbook(result.data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${invoiceExportFilename(result.data.filters, "xlsx")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
