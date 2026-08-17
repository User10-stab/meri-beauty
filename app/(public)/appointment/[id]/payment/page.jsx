import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import ConfirmAcceptedAppointmentClient from "@/components/appointment/ConfirmAcceptedAppointmentClient";

export const dynamic = "force-dynamic";

export default async function AcceptedAppointmentPaymentPage({ params }) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(`/appointment/${id}/payment`)}`);

  const appointment = await prisma.appointment.findUnique({
    where: { id, isDeleted: false },
    select: {
      id: true,
      userId: true,
      status: true,
      date: true,
      startTime: true,
      staffService: {
        select: {
          price: true,
          depositEnabled: true,
          depositPercentage: true,
          allowedPaymentMethods: true,
          service: { select: { name: true } },
          staff: { select: { user: { select: { fullName: true } } } },
        },
      },
    },
  });

  if (!appointment || appointment.userId !== session.user.id) notFound();

  return (
    <ConfirmAcceptedAppointmentClient
      appointment={{
        ...appointment,
        price: Number(appointment.staffService.price),
        depositPercentage: Number(appointment.staffService.depositPercentage ?? 0),
        staffName: appointment.staffService.staff?.user?.fullName ?? "Expert",
        serviceName: appointment.staffService.service.name,
      }}
    />
  );
}
