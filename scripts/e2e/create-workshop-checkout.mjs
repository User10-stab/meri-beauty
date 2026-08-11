import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

const reservationId = process.argv[2];
if (!reservationId) throw new Error("Usage: node scripts/e2e/create-workshop-checkout.mjs <reservationId>");
if (process.env.NODE_ENV === "production") throw new Error("This E2E helper is disabled in production.");
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("A Stripe test secret key is required.");

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

try {
  const reservation = await prisma.workshopReservation.findUnique({
    where: { id: reservationId },
    include: { session: { include: { workshop: true } }, customer: { select: { id: true, email: true } } },
  });
  if (!reservation) throw new Error("Reservation not found.");
  if (reservation.status !== "PENDING_DEPOSIT") throw new Error(`Unexpected status: ${reservation.status}`);

  const { session } = reservation;
  const activity = session.workshop;
  const isFullPayment = Number(reservation.balanceDue) === 0;
  const chargeAmount = isFullPayment ? Number(reservation.totalPrice) : Number(reservation.depositAmount);
  const workshopAction = isFullPayment ? "full_payment" : "deposit";
  const checkout = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "eur",
        product_data: { name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${activity.title}` },
        unit_amount: Math.round(chargeAmount * 100),
      },
      quantity: 1,
    }],
    mode: "payment",
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier/succes?reservation_id=${reservation.id}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier?canceled=true&activity=${activity.id}&session=${session.id}`,
    customer_email: reservation.customer.email,
    metadata: {
      kind: "workshop", workshopAction, reservationId: reservation.id, sessionId: session.id,
      activityId: activity.id, seatsCount: String(reservation.seatsCount), totalPrice: String(reservation.totalPrice),
      depositAmount: String(reservation.depositAmount), balanceDue: String(reservation.balanceDue),
      customerUserId: reservation.customer.id,
    },
    payment_intent_data: { metadata: { kind: "workshop", workshopAction, reservationId: reservation.id } },
  });
  console.log(JSON.stringify({ id: checkout.id, url: checkout.url, reservationId: reservation.id }));
} finally {
  await prisma.$disconnect();
}
