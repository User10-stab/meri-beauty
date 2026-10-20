import { NextResponse } from "next/server";
import { getInvoicesExport } from "@/actions/dashboard/invoices";
import { invoiceFiltersFromSearchParams, invoiceExportFilename } from "@/lib/invoices/export-params";
import { buildInvoicesCsv } from "@/lib/invoices/invoices-csv";

export const runtime = "nodejs";

/**
 * Protected CSV export of the Factures list for the filters on screen. The
 * server action repeats the admin check and re-normalizes the filters, so a
 * hand-edited URL cannot export more than the page permits.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getInvoicesExport(invoiceFiltersFromSearchParams(searchParams));
  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const body = buildInvoicesCsv(result.data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${invoiceExportFilename(result.data.filters, "csv")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
