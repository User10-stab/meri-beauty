import { renderTicketPdf } from "@/lib/pdf/render";
import { sendEmail } from "@/lib/email";
import { captureError } from "@/lib/monitoring";

/**
 * Ateliers, événements, formations and rendez-vous already receive the
 * legally-required Invoice at cash settlement (see
 * lib/reservations/settle-reservation.js and completeAppointment) — but
 * unlike a boutique/POS sale, they never get the compact till-style ticket a
 * customer actually expects as their receipt. Rather than bolting that onto
 * every individual settlement call site, it's generated once per session,
 * right after the till itself closes — one batch, covering every CASH
 * reservation/appointment payment collected during that session.
 *
 * Deliberately excludes anything with `payment.orderId` set: a boutique/POS
 * sale already got its own ticket immediately at checkout (see
 * actions/boutique/point-of-sale.js) — this only fills the gap for the
 * flows that don't.
 *
 * Best-effort throughout: a PDF or email failure here must never undo or
 * block a till closure that has already committed.
 */
export async function sendReservationTicketsForSession(prisma, sessionId) {
  const transactions = await prisma.transaction.findMany({
    where: {
      cashSessionId: sessionId,
      method: "CASH",
      isDeleted: false,
      transactionType: "FINAL_PAYMENT",
      payment: { invoice: { isNot: null }, orderId: null },
    },
    include: {
      payment: {
        include: {
          invoice: true,
          appointment: {
            include: { staffService: { include: { service: { select: { name: true } } } } },
          },
          workshopReservation: {
            include: { session: { include: { workshop: { select: { title: true, type: true } } } } },
          },
          formationReservation: {
            include: { session: { include: { formation: { select: { title: true } } } } },
          },
        },
      },
    },
  });

  let sent = 0;
  for (const transaction of transactions) {
    const invoice = transaction.payment?.invoice;
    if (!invoice || !invoice.customerEmail) continue;

    const description = describeReservationPayment(transaction.payment);

    try {
      const ticketPdf = await renderTicketPdf({
        orderNumber: invoice.number,
        invoiceNumber: invoice.number,
        issuedAt: invoice.issuedAt,
        sellerName: invoice.sellerName,
        sellerAddress: invoice.sellerAddress,
        sellerVatNumber: invoice.sellerVatNumber,
        subtotalExclVat: invoice.subtotalExclVat,
        vatRate: invoice.vatRate,
        vatAmount: invoice.vatAmount,
        totalInclVat: invoice.totalInclVat,
        lines: [{ description, quantity: 1, unitPrice: Number(invoice.totalInclVat) }],
      });

      const amount = Number(invoice.totalInclVat).toFixed(2);
      const result = await sendEmail({
        to: invoice.customerEmail,
        subject: `Votre ticket — ${description} — Meri Beauty`,
        text:
          `Bonjour ${invoice.customerName},\n\n` +
          `Merci pour votre règlement en espèces (${amount} €) — ${description}. Votre ticket est joint à cet e-mail, en complément de votre facture n° ${invoice.number} déjà transmise.\n\n` +
          `L'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${invoice.customerName},</p>` +
          `<p>Merci pour votre règlement en espèces (<strong>${amount} €</strong>) — ${description}.</p>` +
          `<p>Votre ticket est joint à cet e-mail, en complément de votre facture n° ${invoice.number} déjà transmise.</p>` +
          `<p>L'équipe Meri Beauty</p>`,
        attachments: [{ filename: `ticket-${invoice.number}.pdf`, content: ticketPdf }],
      });
      if (result?.success) sent += 1;
      else {
        captureError(new Error(result?.error || "Reservation ticket email failed"), {
          area: "cash-book",
          context: "reservation-ticket-email",
          transactionId: transaction.id,
        });
      }
    } catch (error) {
      captureError(error, { area: "cash-book", context: "reservation-ticket-pdf", transactionId: transaction.id });
    }
  }

  return { checked: transactions.length, sent };
}

export function describeReservationPayment(payment) {
  if (payment.appointment) {
    const service = payment.appointment.staffService?.service?.name;
    return `Rendez-vous${service ? ` — ${service}` : ""}`;
  }
  if (payment.workshopReservation) {
    const workshop = payment.workshopReservation.session?.workshop;
    const noun = workshop?.type === "EVENT" ? "Événement" : "Atelier";
    return `${noun}${workshop?.title ? ` — ${workshop.title}` : ""}`;
  }
  if (payment.formationReservation) {
    const title = payment.formationReservation.session?.formation?.title;
    return `Formation${title ? ` — ${title}` : ""}`;
  }
  return "Prestation";
}
