import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
const prisma = new PrismaClient();
const ids = ["cmtwtmjty0009gciku3e98ls0", "cmtu81dle0009gcbwk64hsqr9"];
for (const id of ids) {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { transactions: true, formationReservation: { select: { id: true, status: true, seatsCount: true, session: { select: { formation: { select: { title: true } } } } } } },
  });
  console.log(JSON.stringify(payment, null, 2));
}
await prisma.$disconnect();
