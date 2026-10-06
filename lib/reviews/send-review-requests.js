import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { reviewThankYouEmail } from "@/lib/email-templates";
import { createReviewToken } from "@/lib/review-token";

/**
 * Sends review request emails to clients whose reservation/appointment/order is
 * COMPLETED, has no review yet, has NOT had a review request sent yet (reviewRequestedAt == null),
 * and was completed at least 3 days ago.
 */
export async function sendReviewRequests() {
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  let sentCount = 0;

  try {
    // 1. Appointments
    const appointments = await prisma.appointment.findMany({
      where: {
        status: "COMPLETED",
        review: null,
        reviewRequestedAt: null,
        AND: [
          {
            startTime: {
              lt: new Date(now - threeDaysMs),
            },
          },
        ],
      },
      include: {
        user: { select: { email: true, fullName: true } },
        staffService: {
          select: {
            staffId: true,
            staff: { select: { user: { select: { email: true, fullName: true } } } },
            service: { select: { name: true } },
          },
        },
      },
    });

    for (const appointment of appointments) {
      const customer = appointment.user;
      const serviceName = appointment.staffService?.service?.name ?? "votre rendez-vous";

      if (!customer?.email) continue;

      try {
        const reviewToken = createReviewToken({
          reservationType: "APPOINTMENT",
          reservationId: appointment.id,
          email: customer.email,
        });
        const reviewLink = `${process.env.NEXT_PUBLIC_URL || "https://merribeauty.com"}/nouvel-avis?token=${reviewToken}`;

        await sendEmail({
          to: customer.email,
          ...reviewThankYouEmail({
            customerName: customer.fullName || "vous",
            serviceName,
            rating: 5,
            reviewLink,
          }),
        });

        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { reviewRequestedAt: new Date() },
        });

        sentCount++;
        console.log(
          "[background-jobs] Review request email sent to",
          customer.email,
          "for appointment",
          appointment.id
        );
      } catch (err) {
        console.error(
          "[background-jobs] Failed to send review request email to",
          customer.email,
          ":",
          err.message
        );
      }
    }

    // 2. Workshop reservations
    const workshopReservations = await prisma.workshopReservation.findMany({
      where: {
        status: "COMPLETED",
        review: null,
        reviewRequestedAt: null,
        AND: [
          {
            session: {
              startTime: {
                lt: new Date(now - threeDaysMs),
              },
            },
          },
        ],
      },
      include: {
        customer: { select: { email: true, fullName: true } },
        session: {
          select: { startTime: true, workshop: { select: { title: true } } },
        },
      },
    });

    for (const reservation of workshopReservations) {
      const customer = reservation.customer;
      const workshopTitle = reservation.session?.workshop?.title ?? "atelier";

      if (!customer?.email) continue;

      try {
        const reviewToken = createReviewToken({
          reservationType: "WORKSHOP",
          reservationId: reservation.id,
          email: customer.email,
        });
        const reviewLink = `${process.env.NEXT_PUBLIC_URL || "https://merribeauty.com"}/nouvel-avis?token=${reviewToken}`;

        await sendEmail({
          to: customer.email,
          ...reviewThankYouEmail({
            customerName: customer.fullName || "vous",
            serviceName: workshopTitle,
            rating: 5,
            reviewLink,
          }),
        });

        await prisma.workshopReservation.update({
          where: { id: reservation.id },
          data: { reviewRequestedAt: new Date() },
        });

        sentCount++;
        console.log(
          "[background-jobs] Review request email sent to",
          customer.email,
          "for workshop reservation",
          reservation.id
        );
      } catch (err) {
        console.error(
          "[background-jobs] Failed to send review request email to",
          customer.email,
          ":",
          err.message
        );
      }
    }

    // 3. Formation reservations
    const formationReservations = await prisma.formationReservation.findMany({
      where: {
        status: "COMPLETED",
        review: null,
        reviewRequestedAt: null,
        AND: [
          {
            session: {
              startTime: {
                lt: new Date(now - threeDaysMs),
              },
            },
          },
        ],
      },
      include: {
        customer: { select: { email: true, fullName: true } },
        session: {
          select: { startTime: true, formation: { select: { title: true } } },
        },
      },
    });

    for (const reservation of formationReservations) {
      const customer = reservation.customer;
      const formationTitle = reservation.session?.formation?.title ?? "formation";

      if (!customer?.email) continue;

      try {
        const reviewToken = createReviewToken({
          reservationType: "FORMATION",
          reservationId: reservation.id,
          email: customer.email,
        });
        const reviewLink = `${process.env.NEXT_PUBLIC_URL || "https://merribeauty.com"}/nouvel-avis?token=${reviewToken}`;

        await sendEmail({
          to: customer.email,
          ...reviewThankYouEmail({
            customerName: customer.fullName || "vous",
            serviceName: formationTitle,
            rating: 5,
            reviewLink,
          }),
        });

        await prisma.formationReservation.update({
          where: { id: reservation.id },
          data: { reviewRequestedAt: new Date() },
        });

        sentCount++;
        console.log(
          "[background-jobs] Review request email sent to",
          customer.email,
          "for formation reservation",
          reservation.id
        );
      } catch (err) {
        console.error(
          "[background-jobs] Failed to send review request email to",
          customer.email,
          ":",
          err.message
        );
      }
    }

    // 4. Boutique Orders (COMPLETED)
    const boutiqueOrders = await prisma.order.findMany({
      where: {
        status: "COMPLETED",
        reviewRequestedAt: null,
        userId: { not: null },
        updatedAt: {
          lt: new Date(now - threeDaysMs),
        },
      },
      include: {
        user: { select: { email: true, fullName: true } },
      },
    });

    for (const order of boutiqueOrders) {
      const customer = order.user;
      if (!customer?.email) continue;

      try {
        const reviewToken = createReviewToken({
          reservationType: "ORDER",
          reservationId: order.id,
          email: customer.email,
        });
        const reviewLink = `${process.env.NEXT_PUBLIC_URL || "https://merribeauty.com"}/nouvel-avis?token=${reviewToken}`;

        await sendEmail({
          to: customer.email,
          ...reviewThankYouEmail({
            customerName: customer.fullName || "vous",
            serviceName: "votre commande boutique",
            rating: 5,
            reviewLink,
          }),
        });

        await prisma.order.update({
          where: { id: order.id },
          data: { reviewRequestedAt: new Date() },
        });

        sentCount++;
        console.log(
          "[background-jobs] Review request email sent to",
          customer.email,
          "for boutique order",
          order.id
        );
      } catch (err) {
        console.error(
          "[background-jobs] Failed to send review request email to",
          customer.email,
          ":",
          err.message
        );
      }
    }
  } catch (err) {
    console.error("[background-jobs] Error sending review requests:", err);
  }

  return { sentCount };
}
