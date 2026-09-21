import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { buildPendingInvoicePreview } from "@/lib/invoices/invoice-preview";

// react-pdf needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * « Aperçu » on a pending row of the Factures page: the invoice accepting the
 * payment would issue, rendered without issuing it — no number is taken,
 * nothing is written (lib/invoices/invoice-preview.js).
 *
 * Admin-only, like the Factures page and its accept actions.
 */
export async function GET(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!isAdminRole(session.user.role)) return NextResponse.json({ error: "Non autorisé." }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const preview = await buildPendingInvoicePreview({ kind: searchParams.get("kind"), id: searchParams.get("id") });

  // No invoice would be issued (or it would be refused): say why, readably,
  // in the tab the button opened.
  if (!preview.invoice) {
    const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Aperçu de facture</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#1f2a1e;background:#fff">
<h1 style="font-size:18px">Pas de facture à prévisualiser</h1>
<p style="line-height:1.5">${escapeHtml(preview.message)}</p></body></html>`;
    return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const pdf = await renderInvoicePdf(preview.invoice);
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="apercu-facture.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
