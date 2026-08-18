"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";

export async function checkOnboardingStatus() {
  const session = await auth();
  if (!session?.user || session.user.role !== ROLES.STAFF) {
    return { isStaff: false };
  }

  const staff = await prisma.staff.findUnique({
    where: { userId: session.user.id },
    include: {
      contracts: { take: 1 },
      workingHours: { take: 1 },
      _count: {
        select: {
          staffServices: { where: { isActive: true } },
        },
      },
    },
  });

  if (!staff) {
    return { isStaff: true, setupCompleted: false, hasServices: false, stripeConnected: false };
  }

  const hasLanguages = staff.languages.length > 0;
  const hasContract = staff.contracts.length > 0;
  const hasWorkingHours = staff.workingHours.length > 0;
  const setupCompleted = hasLanguages && hasContract && hasWorkingHours;

  if (setupCompleted && !staff.setupCompleted) {
    await prisma.staff.update({
      where: { id: staff.id },
      data: { setupCompleted: true },
    });
  }

  const stripeConnected = staff.stripeChargesEnabled && staff.stripePayoutsEnabled;

  // Stripe is only required for staff who accept online payments
  const acceptsOnlinePayments =
    staff.allowedPaymentMethods === "BOTH" || staff.allowedPaymentMethods === "ONLINE_ONLY";
  const stripeRequired = acceptsOnlinePayments && !stripeConnected;

  return {
    isStaff: true,
    setupCompleted,
    // Which specific steps are still missing. The onboarding modal used to
    // show a fixed list with no state, so a staff member who had filled in
    // their photo and bio still saw "Profil" unticked with nothing telling
    // them the actual gate is "at least one language".
    steps: [
      { key: "languages", label: "Profil — au moins une langue parlée", done: hasLanguages },
      { key: "contract", label: "Contrat", done: hasContract },
      { key: "workingHours", label: "Horaires de travail", done: hasWorkingHours },
    ],
    hasServices: staff._count.staffServices > 0,
    stripeConnected,
    stripeRequired,
  };
}
