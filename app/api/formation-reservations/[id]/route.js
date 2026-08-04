import { prisma } from "@/lib/prisma";

/**
 * Polled anonymously by the reservation success page right after the Stripe
 * redirect — the webhook confirms payment asynchronously, so the customer
 * (often a guest with no session yet) needs to check status without being
 * logged in. That means this route can't require auth(), so instead it
 * limits the response to exactly what the success page renders: no
 * customerId, participants, or notes (all real PII/private data that used
 * to come back on every request, to anyone who has or guesses the id).
 */
export async function GET(req, { params }) {
  const { id } = await params;

  try {
    const reservation = await prisma.formationReservation.findUnique({
      where: { id },
      select: {
        status: true,
        seatsCount: true,
        totalPrice: true,
        depositAmount: true,
        balanceDue: true,
        session: {
          select: {
            startDate: true,
            formation: { select: { title: true } },
          },
        },
      },
    });

    if (!reservation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(reservation);
  } catch {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
