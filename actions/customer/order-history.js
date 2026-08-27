"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { pickupQrDataUrl, checkInQrDataUrl } from "@/lib/qrcode";
import { CHECK_IN_KINDS, ensureCheckInCode } from "@/lib/activities/check-in-code";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

const CLOSED_ORDER_STATUSES = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);

// Only a CONFIRMED reservation carries a ticket. PENDING_DEPOSIT has not paid
// yet, and CANCELLED / COMPLETED / NO_SHOW are all doors that already closed —
// showing a scannable QR on any of them invites an argument at the entrance.
const TICKETED_RESERVATION_STATUS = "CONFIRMED";

async function attachPickupQr(order) {
  const canCollectInStore = Boolean(
    order.source !== "POS" &&
    order.pickupCode &&
    order.fulfilmentMode !== "SHIPPING_PREPAID" &&
    !CLOSED_ORDER_STATUSES.has(order.status)
  );

  if (!canCollectInStore) return { ...order, pickupQr: null };

  try {
    return { ...order, pickupQr: await pickupQrDataUrl(order.pickupCode) };
  } catch (error) {
    // The readable pickup code remains available if image generation ever
    // fails, so one QR failure must not hide the customer's order history.
    console.error("[getMyOrderHistory] Pickup QR generation failed:", error);
    return { ...order, pickupQr: null };
  }
}

/**
 * Mints the check-in code on first read rather than when the payment is
 * confirmed. Deliberate: minting inside the payment transaction would put a
 * unique-index collision — however unlikely — on the same rollback path as a
 * captured Stripe charge. Nothing needs the code before the customer looks at
 * it, so the cheap, safe moment is here.
 */
async function attachCheckInQr(reservation, kind) {
  if (reservation.status !== TICKETED_RESERVATION_STATUS) {
    // Strip any code minted earlier: a cancelled booking must not keep
    // handing a live-looking ticket to the client bundle.
    return { ...reservation, checkInCode: null, checkInQr: null };
  }

  try {
    const code = reservation.checkInCode ?? (await ensureCheckInCode(prisma, kind, reservation.id));
    if (!code) return { ...reservation, checkInCode: null, checkInQr: null };
    return { ...reservation, checkInCode: code, checkInQr: await checkInQrDataUrl(code) };
  } catch (error) {
    // The rest of the booking history is worth more than the QR — degrade to
    // no ticket rather than failing the whole page.
    console.error("[getMyOrderHistory] check-in QR generation failed:", error);
    return { ...reservation, checkInCode: null, checkInQr: null };
  }
}

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

  const [ordersWithPickupQr, workshopsWithQr, formationsWithQr] = await Promise.all([
    Promise.all(orders.map(attachPickupQr)),
    Promise.all(workshopReservations.map((r) => attachCheckInQr(r, CHECK_IN_KINDS.WORKSHOP))),
    Promise.all(formationReservations.map((r) => attachCheckInQr(r, CHECK_IN_KINDS.FORMATION))),
  ]);

  return {
    success: true,
    data: {
      orders: serializeDecimalFields(ordersWithPickupQr),
      workshopReservations: serializeDecimalFields(workshopsWithQr),
      formationReservations: serializeDecimalFields(formationsWithQr),
    },
  };
}
