import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyAppointmentConfirmToken } from "@/lib/appointment-confirm-token";
import ConfirmAcceptedAppointmentClient from "@/components/appointment/ConfirmAcceptedAppointmentClient";

export const dynamic = "force-dynamic";

export default async function AcceptedAppointmentPaymentPage({ params, searchParams }) {
  const session = await auth();
  const { id } = await params;
  const sp = await searchParams;
  const confirmToken = typeof sp?.confirm === "string" && sp.confirm ? sp.confirm : null;

  const appointment = await prisma.appointment.findUnique({
    where: { id, isDeleted: false },
    select: {
      id: true,
      userId: true,
      status: true,
      date: true,
      startTime: true,
      user: { select: { email: true } },
      staffService: {
        select: {
          price: true,
          service: { select: { name: true } },
          staff: {
            select: {
              depositEnabled: true,
              depositPercentage: true,
              allowedPaymentMethods: true,
              user: { select: { fullName: true } },
            },
          },
        },
      },
    },
  });

  if (!appointment) {
    notFound();
  }

  // Ownership by the current session, or by a valid confirmation token from
  // the acceptance email. The token is cryptographically bound to this exact
  // appointment and its owner's email (it is only ever delivered inside an
  // email to that address), so possession proves ownership of the
  // appointment without any login — and no user identifier rides in the URL.
  const isOwner = session?.user?.id != null && appointment.userId === session.user.id;
  const verifiedToken =
    confirmToken && verifyAppointmentConfirmToken(confirmToken, { appointmentId: id });
  const tokenAuthorized = verifiedToken?.ok && verifiedToken.email === appointment.user.email;

  if (!isOwner && !tokenAuthorized) {
    if (!session?.user?.id) {
      redirect(`/login?callbackUrl=${encodeURIComponent(`/appointment/${id}/payment`)}`);
    }
    notFound();
  }

  return (
    <ConfirmAcceptedAppointmentClient
      appointment={{
        ...appointment,
        price: Number(appointment.staffService.price),
        depositPercentage: Number(appointment.staffService.staff?.depositPercentage ?? 0),
        staffName: appointment.staffService.staff?.user?.fullName ?? "Expert",
        serviceName: appointment.staffService.service.name,
        staffService: {
          ...appointment.staffService,
          depositEnabled: appointment.staffService.staff?.depositEnabled ?? false,
          allowedPaymentMethods: appointment.staffService.staff?.allowedPaymentMethods ?? "BOTH",
        },
      }}
      confirmToken={tokenAuthorized ? confirmToken : null}
    />
  );
}
