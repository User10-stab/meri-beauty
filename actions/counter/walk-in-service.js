"use server";

import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES, STAFF_PERMISSIONS, getStaffId, hasDashboardPermission, isAdminRole } from "@/lib/authorization";
import { completeAppointment } from "@/actions/appointment/manage-appointment";
import { CounterCustomerError, PhoneAlreadyRegisteredError } from "@/lib/reservation-errors";
import { counterCustomerSchema } from "@/lib/validations/counter-customer";
import { resolveCounterCustomer } from "@/lib/counter/resolve-counter-customer";

// Same "existing account, or a brand-new one with a phone" shape as
// create-reservation.js's own buyerSchema. The {userId} branch merges in the
// VAT/address picks too — an already-matched customer can still turn this
// sale into a B2B one (add a VAT number, supply an address) exactly like a
// counter-created reservation can; without the merge, zod's default
// unknown-key stripping would silently drop a VAT number typed for an
// existing customer instead of validating and saving it.
const customerSchema = z.union([
  z.object({ userId: z.string().min(1) }).merge(
    counterCustomerSchema.pick({
      vatNumber: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressPostalCode: true,
      addressCountry: true,
    })
  ),
  counterCustomerSchema.omit({ id: true }).extend({ phone: z.string().trim().min(6) }),
]);

const saleSchema = z.object({
  staffServiceId: z.string().min(1),
  customer: customerSchema,
  // Card is EXTERNAL_TERMINAL only — see the note in completeAppointment.
  method: z.enum(["CASH", "EXTERNAL_TERMINAL"]),
  paymentConfirmed: z.literal(true),
  terminalApproved: z.boolean().optional(),
  terminalReference: z.string().trim().max(100).optional(),
  finalTotal: z.number().nonnegative().max(100_000).optional(),
  adjustmentReason: z.string().trim().max(250).optional(),
});

async function authorizeCounterAppointments() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  const [canUseTill, canManageAppointments] = await Promise.all([
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE),
    hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS),
  ]);
  if (!canUseTill || !canManageAppointments) return { error: "Accès non autorisé." };

  let ownStaffId = null;
  if (!isAdminRole(session.user.role) && session.user.role === ROLES.STAFF) {
    ownStaffId = await getStaffId(session);
    if (!ownStaffId) return { error: "Profil staff introuvable." };
  }
  return { session, ownStaffId };
}

function serviceCode(value) {
  return String(value ?? "").trim().replace(/^S(?:ERVICE)?[:\-]/i, "");
}

/** Search the real service catalogue. A QR may contain S:<staffServiceId>. */
export async function searchCounterServices(query) {
  const guard = await authorizeCounterAppointments();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const value = String(query ?? "").trim();
  if (value.length < 2) return { success: true, data: [] };
  const code = serviceCode(value);

  try {
    const rows = await prisma.staffService.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        price: { gt: 0 },
        duration: { gt: 0 },
        staff: { isActive: true, isDeleted: false },
        service: { isDeleted: false },
        ...(guard.ownStaffId ? { staffId: guard.ownStaffId } : {}),
        OR: [
          { id: code },
          { service: { name: { contains: value, mode: "insensitive" } } },
          { service: { category: { name: { contains: value, mode: "insensitive" } } } },
          { staff: { user: { fullName: { contains: value, mode: "insensitive" } } } },
        ],
      },
      select: {
        id: true,
        price: true,
        duration: true,
        service: { select: { name: true, category: { select: { name: true } } } },
        staff: { select: { id: true, user: { select: { fullName: true } } } },
      },
      orderBy: [{ service: { name: "asc" } }, { staff: { user: { fullName: "asc" } } }],
      take: 20,
    });

    return {
      success: true,
      data: rows.map((row) => ({
        staffServiceId: row.id,
        serviceName: row.service.name,
        categoryName: row.service.category?.name ?? null,
        staffName: row.staff.user?.fullName ?? "Membre du personnel",
        staffId: row.staff.id,
        price: Number(row.price),
        duration: row.duration,
        qrValue: `S:${row.id}`,
      })),
    };
  } catch (error) {
    console.error("[searchCounterServices]", error);
    return { success: false, message: "Impossible de charger les prestations.", data: [] };
  }
}

/**
 * Records a walk-in against a real StaffService, then settles it through the
 * same appointment completion action used everywhere else.
 */
export async function createCounterWalkInService(input) {
  const guard = await authorizeCounterAppointments();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Vérifiez la prestation, le client et le paiement." };
  const data = parsed.data;

  if (data.method === "EXTERNAL_TERMINAL" && (!data.terminalApproved || !data.terminalReference)) {
    return { success: false, message: "Confirmez le terminal approuvé et indiquez sa référence." };
  }

  let appointmentId = null;
  try {
    const staffService = await prisma.staffService.findFirst({
      where: {
        id: data.staffServiceId,
        isActive: true,
        isDeleted: false,
        staff: { isActive: true, isDeleted: false },
        service: { isDeleted: false },
        ...(guard.ownStaffId ? { staffId: guard.ownStaffId } : {}),
      },
      select: { id: true, staffId: true, duration: true, price: true },
    });
    if (!staffService) return { success: false, message: "Prestation introuvable ou non autorisée." };

    // Same resolver a booking-buyer completion uses (actions/counter/
    // update-buyer.js): a B2B walk-in now gets the same VAT/VIES and
    // address rule here as everywhere else in the counter, instead of this
    // path only ever creating a bare {fullName,email,phone} B2C account.
    const user = await resolveCounterCustomer(prisma, data.customer);

    const completedAt = new Date();
    // The empty interval is intentional: while CONFIRMED, the database's
    // no-overlap constraint must not reject the accounting bridge because a
    // scheduled appointment overlaps the service that just happened. Once
    // settlement changes it to COMPLETED (which no longer occupies capacity),
    // the actual catalogue duration is restored below.
    const appointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        staffServiceId: staffService.id,
        staffId: staffService.staffId,
        date: completedAt,
        startTime: completedAt,
        endTime: completedAt,
        status: "CONFIRMED",
        notes: "Prestation sans réservation enregistrée au comptoir.",
      },
      select: { id: true },
    });
    appointmentId = appointment.id;

    const result = await completeAppointment(appointment.id, {
      method: data.method,
      paymentConfirmed: true,
      terminalApproved: data.terminalApproved,
      terminalReference: data.terminalReference,
      finalTotal: data.finalTotal,
      adjustmentReason: data.adjustmentReason,
    });
    if (!result.success) {
      await prisma.appointment.delete({ where: { id: appointment.id } }).catch(() => {});
      return result;
    }

    const startedAt = new Date(completedAt.getTime() - staffService.duration * 60_000);
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { date: startedAt, startTime: startedAt, endTime: completedAt },
    }).catch((error) => {
      // Settlement is already committed. Never tell the cashier to retry a
      // real payment merely because this display-only duration repair failed.
      console.error("[createCounterWalkInService] duration repair failed", error);
    });

    await prisma.auditLog.create({
      data: {
        actorId: guard.session.user.id,
        actorRole: guard.session.user.role,
        action: "reservation.created_at_counter",
        entityType: "Appointment",
        entityId: appointment.id,
        after: {
          status: "COMPLETED",
          staffServiceId: staffService.id,
          cataloguePrice: Number(staffService.price),
          finalTotal: data.finalTotal ?? Number(staffService.price),
        },
      },
    }).catch((error) => {
      // The price adjustment itself is audited atomically in
      // completeAppointment. This supplementary origin marker must not turn
      // a successful, already-recorded collection into a retry prompt.
      console.error("[createCounterWalkInService] origin audit failed", error);
    });

    return { success: true, message: "Prestation enregistrée et encaissée.", data: { appointmentId: appointment.id } };
  } catch (error) {
    if (appointmentId) {
      await prisma.appointment.delete({ where: { id: appointmentId, status: "CONFIRMED" } }).catch(() => {});
    }
    if (error instanceof PhoneAlreadyRegisteredError) {
      return { success: false, message: "Ce numéro est déjà associé à un autre compte." };
    }
    if (error instanceof CounterCustomerError) {
      return { success: false, message: error.message };
    }
    console.error("[createCounterWalkInService]", error);
    return { success: false, message: "Impossible d'enregistrer cette prestation." };
  }
}
