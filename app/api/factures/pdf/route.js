import { NextResponse } from "next/server";
import { getInvoicesExport } from "@/actions/dashboard/invoices";
import { invoiceFiltersFromSearchParams, invoiceExportFilename } from "@/lib/invoices/export-params";
import { renderInvoicesListPdf } from "@/lib/pdf/render";

export const runtime = "nodejs";

/**
 * Protected PDF export of the Factures list for the filters on screen. The
 * server action repeats the admin check and re-normalizes the filters, so a
 * hand-edited URL cannot export more than the page permits.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const result = await getInvoicesExport(invoiceFiltersFromSearchParams(searchParams));
  if (!result.success) {
    return NextResponse.json({ error: result.message ?? "Export indisponible." }, { status: 403 });
  }

  const body = await renderInvoicesListPdf(result.data);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoiceExportFilename(result.data.filters, "pdf")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
