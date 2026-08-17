"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

/**
 * Everything the logged-in visitor has ever bought or booked, across the
 * three separate reservation systems (boutique orders, atelier/événement
 * reservations, formation reservations) — they share no common table, so
 * this is a 3-way fetch rather than one query.
 */
export async function getMyOrderHistory() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const userId = session.user.id;

  const invoiceSelect = { select: { invoice: { select: { id: true, number: true } } } };

  const [orders, workshopReservations, formationReservations] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      include: {
        items: { select: { productName: true, variantName: true, quantity: true, unitPrice: true } },
        payment: invoiceSelect,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.workshopReservation.findMany({
      where: { customerId: userId },
      include: {
        session: {
          select: {
            startDate: true,
            endDate: true,
            workshop: { select: { title: true, type: true, cover: true } },
          },
        },
        payment: invoiceSelect,
        // Drives the "demande en attente / refusée" state on the reservation
        // card — neither flow allows self-cancellation, so the customer's
        // only route is an exception request (see
        // actions/reservations/cancellation-request.js).
        cancellationRequest: { select: { status: true, decisionNote: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.formationReservation.findMany({
      where: { customerId: userId },
      include: {
        session: {
          select: {
            startDate: true,
            endDate: true,
            formation: { select: { title: true, type: true, cover: true } },
          },
        },
        payment: invoiceSelect,
        cancellationRequest: { select: { status: true, decisionNote: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    success: true,
    data: {
      orders: serializeDecimalFields(orders),
      workshopReservations: serializeDecimalFields(workshopReservations),
      formationReservations: serializeDecimalFields(formationReservations),
    },
  };
}
