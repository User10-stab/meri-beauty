import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { staffFormationReservationPaidEmail } from "@/lib/email-templates";
import { resolveFormationOwnerStaff } from "@/lib/formations/custom-date-availability";

/**
 * E-mails the staff member whose calendar the formation runs on — the
 * session's animator, else the formation's, else its creator (the same owner
 * the « date libre » picker books). An outside animator with no staff
 * account gets nothing: admins already have the dashboard notification.
 */
export async function notifyFormationStaffOfPaidReservation(reservation, { sessionDate, sessionRange, paidAmount, totalAmount, isFullPayment }) {
  const { session } = reservation;
  const owner = await resolveFormationOwnerStaff(prisma, {
    animatorId: session.animatorId ?? session.formation.animatorId,
    createdById: session.formation.createdById,
  });
  if (!owner?.user?.email) return;

  const staff = await prisma.staff.findUnique({
    where: { id: owner.id },
    select: { professionalName: true, user: { select: { fullName: true } } },
  });

  await sendEmail({
    to: owner.user.email,
    ...staffFormationReservationPaidEmail({
      staffName: staff?.professionalName || staff?.user?.fullName || "",
      customerName: reservation.customer.fullName,
      customerEmail: reservation.customer.email,
      customerPhone: reservation.customer.phone,
      formationTitle: session.formation.title,
      sessionDate,
      dayCount: sessionRange.dayCount,
      customerChoseDate: session.customerRequested === true,
      seatsCount: reservation.seatsCount,
      paidAmount,
      totalAmount,
      isFullPayment,
    }),
  });
}
