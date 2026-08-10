import { PrismaClient } from "@prisma/client";

const reservationId = process.argv[2];
if (!reservationId) throw new Error("Usage: node scripts/e2e/inspect-workshop-refund.mjs <reservationId>");
const prisma = new PrismaClient();
try {
  const reservation = await prisma.workshopReservation.findUnique({
    where: { id: reservationId },
    include: {
      payment: { include: { transactions: { orderBy: { createdAt: "asc" } }, invoice: { include: { creditNotes: true } } } },
      session: { include: { workshop: { select: { title: true, type: true } } } },
    },
  });
  if (!reservation) throw new Error("Reservation not found.");
  const occupied = await prisma.workshopReservation.aggregate({
    where: { sessionId: reservation.sessionId, status: { in: ["CONFIRMED", "COMPLETED"] } },
    _sum: { seatsCount: true },
  });
  const creditNotes = reservation.payment?.invoice?.creditNotes.map((note) => ({
    number: note.number, totalInclVat: note.totalInclVat,
  })) ?? [];
  console.log(JSON.stringify({
    activity: reservation.session.workshop,
    reservation: { id: reservation.id, status: reservation.status, seatsCount: reservation.seatsCount, cancelledAt: reservation.cancelledAt },
    occupiedSeats: occupied._sum.seatsCount ?? 0,
    payment: reservation.payment && { status: reservation.payment.status, paidAmount: reservation.payment.paidAmount, stripeSessionId: reservation.payment.stripeSessionId },
    transactions: reservation.payment?.transactions.map((t) => ({ type: t.transactionType, amount: t.amount, stripePaymentIntentId: t.stripePaymentIntentId })),
    creditNotes,
  }));
} finally {
  await prisma.$disconnect();
}
