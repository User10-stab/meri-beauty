import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isTillCashOperator } from "@/lib/authorization";
import { readStoredShippingLabel } from "@/lib/mondial-relay-label-storage";

// Reading a file from disk needs Node APIs — not edge-compatible.
export const runtime = "nodejs";

/**
 * Reprint a Mondial Relay shipping label.
 *
 * The label is an internal document (staff print it and hand it to the
 * carrier, the customer never sees it) — same audience as the "Générer
 * l'étiquette" button on the order detail page, gated by isTillCashOperator
 * (see actions/boutique/mondial-relay.js's requireOrdersAccess-equivalent).
 *
 * Serves the locally stored copy (lib/mondial-relay-label-storage.js) —
 * this exists specifically so a blocked popup or a closed tab on the first
 * generation never loses an already-purchased label. Falls back to Mondial
 * Relay's own URL only if the local copy is missing (the store step failed
 * at generation time — see generateShippingLabel).
 */
export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user || !isTillCashOperator(session.user)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { trackingCode: true, labelUrl: true, orderNumber: true },
  });
  if (!order || !order.trackingCode) {
    return NextResponse.json({ error: "Pas d'étiquette pour cette commande." }, { status: 404 });
  }

  const pdf = await readStoredShippingLabel(id);
  if (pdf) {
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="etiquette-${order.orderNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Degraded fallback only — the local copy step failed at generation time.
  if (order.labelUrl) {
    return NextResponse.redirect(order.labelUrl);
  }

  return NextResponse.json(
    { error: "Étiquette introuvable — ni copie locale, ni lien Mondial Relay enregistré." },
    { status: 404 }
  );
}
