"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

/**
 * The logged-in customer's own salon service appointments — distinct from
 * getMyOrderHistory (boutique orders + atelier/formation reservations),
 * since regular service bookings live on a separate Appointment table.
 */
export async function getMyAppointments() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e).", data: [] };
  }

  try {
    const appointments = await prisma.appointment.findMany({
      where: { userId: session.user.id, isDeleted: false },
      orderBy: { startTime: "desc" },
      include: {
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: { select: { id: true, user: { select: { fullName: true } } } },
          },
        },
        payment: { select: { invoice: { select: { id: true, number: true } } } },
        review: { select: { id: true, rating: true, comment: true } },
      },
    });

    const data = appointments.map((a) => ({
      id: a.id,
      date: a.date,
      startTime: a.startTime,
      endTime: a.endTime,
      status: a.status,
      notes: a.notes,
      staffServiceId: a.staffServiceId,
      serviceName: a.staffService.service.name,
      staffName: a.staffService.staff?.user?.fullName ?? "—",
      payment: a.payment,
      review: a.review,
    }));

    return { success: true, data: serializeDecimalFields(data) };
  } catch (error) {
    console.error("[getMyAppointments]", error);
    return { success: false, message: "Impossible de charger vos rendez-vous.", data: [] };
  }
}
