import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canAccessDashboard } from "@/lib/authorization";
import { renderCreditNotePdf } from "@/lib/pdf/render";

export const runtime = "nodejs";

export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user || !canAccessDashboard(session.user.role)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const { id } = await params;

  const creditNote = await prisma.creditNote.findUnique({
    where: { id },
    include: { invoice: { include: { lines: true } } },
  });
  if (!creditNote) {
    return NextResponse.json({ error: "Note de crédit introuvable." }, { status: 404 });
  }

  const pdf = await renderCreditNotePdf(creditNote, creditNote.invoice);

  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="note-de-credit-${creditNote.number}.pdf"`,
    },
  });
}
