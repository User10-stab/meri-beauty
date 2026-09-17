import { ROLES, TILL_CASH_OPERATOR_EMAIL } from "@/lib/authorization";

/**
 * Who *is* the salon, expressed as database identifiers.
 *
 * Every practitioner here is legally independent (`Staff.type = INDEPENDENT`)
 * and invoices under their own VAT number, so a sale one of them collects is
 * their revenue, not the salon's. Two accounts — and only two — are the salon
 * itself:
 *
 *   - every ADMIN/OWNER user (`admin@meribeauty.com` in production);
 *   - the user whose e-mail is `TILL_CASH_OPERATOR_EMAIL` (Marie Mercier,
 *     `contact@meribeautystudio.com`), whose VAT number *is* the salon's.
 *
 * Marie is the case that matters: her role is `STAFF`, so any rule written as
 * "if STAFF then exclude" silently deletes the salon's own revenue from the
 * salon's own books. This module is the single place where that exemption
 * turns into ids — reuse it, never re-derive the rule and never hard-code the
 * address (`lib/authorization.js` owns the constant so a dev/staging Marie
 * works the same way).
 *
 * Two id spaces come back because the schema attributes work through two
 * different keys, exactly as actions/dashboard/get-reports-data.js does:
 *
 *   - `salonUserIds` — `User.id`, what `Order.createdByStaffId` points at;
 *   - `salonStaffIds` — `Staff.id`, what `Appointment.staffId` points at.
 *     Marie's appointments hang off her *Staff* row, so leaving this out
 *     would drop every service she performs.
 *
 * Soft-deleted accounts are deliberately kept: an admin who leaves does not
 * retroactively stop the sales they rang up from being the salon's.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @returns {Promise<{ salonUserIds: string[], salonStaffIds: string[] }>}
 */
export async function resolveSalonScope(client) {
  const users = await client.user.findMany({
    where: {
      OR: [
        { role: { in: [ROLES.ADMIN, ROLES.OWNER] } },
        { email: { equals: TILL_CASH_OPERATOR_EMAIL, mode: "insensitive" } },
      ],
    },
    select: { id: true, staff: { select: { id: true } } },
  });

  return {
    salonUserIds: users.map((u) => u.id),
    // An ADMIN normally has no Staff row at all — only Marie contributes here.
    salonStaffIds: users.map((u) => u.staff?.id).filter(Boolean),
  };
}

/**
 * The `Payment` where-arms that make a payment the salon's own, for any query
 * that sums money (dashboard revenue, rapports, livre de recettes). Use it as
 * `{ OR: salonPaymentArms(scope) }` on a Payment, or under `payment:` on a
 * Transaction.
 *
 * An independent's payment matches none of these arms, so it never reaches a
 * salon total. The salon has no view that adds it back in.
 *
 * @param {{ salonUserIds: string[], salonStaffIds: string[] }} scope - from resolveSalonScope
 */
export function salonPaymentArms(scope) {
  return [
    // Order.createdByStaffId → User.id ; Appointment.staffId → Staff.id.
    // The two id spaces are not interchangeable.
    { order: { createdByStaffId: { in: scope.salonUserIds } } },
    // A customer buying online stamps no one: salon revenue.
    { order: { createdByStaffId: null } },
    { appointment: { staffId: { in: scope.salonStaffIds } } },
    // Ateliers and formations are the salon's own events — they carry no
    // staff link in the schema at all (the animator is matched by e-mail,
    // with no foreign key), so there is nothing to attribute to an independent.
    { workshopReservationId: { not: null } },
    { formationReservationId: { not: null } },
    // Attached to none of the four sources: no owner to hand it to, so it
    // stays the salon's — same reasoning as an unstamped order.
    { orderId: null, appointmentId: null, workshopReservationId: null, formationReservationId: null },
  ];
}
