import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
const prisma = new PrismaClient();
const payments = await prisma.payment.findMany({
  where: {
    status: "PAID",
    OR: [{ appointmentId: { not: null } }, { workshopReservationId: { not: null } }, { formationReservationId: { not: null } }],
  },
  select: { id: true, ticketNumber: true, ticketKind: true, status: true, appointmentId: true, workshopReservationId: true, formationReservationId: true,
    transactions: { select: { id: true, isDeleted: true, transactionType: true, amount: true, paidAt: true } } },
  orderBy: { paidAt: "desc" },
  take: 5,
});
console.log(JSON.stringify(payments, null, 2));
await prisma.$disconnect();
