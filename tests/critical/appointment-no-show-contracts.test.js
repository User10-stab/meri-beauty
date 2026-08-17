import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Before this, NO_SHOW was a valid Appointment.status enum value displayed
// in 8+ components but never written anywhere — the only way to close out a
// missed appointment was "Annuler" (rejectAppointment), which always issues
// a full automatic refund and treats an absence identically to a
// business-initiated cancellation.
describe("marking an appointment as a no-show never touches Payment", () => {
  const actions = source("actions/appointment/manage-appointment.js");
  const schema = source("prisma/schema.prisma");

  test("markAppointmentNoShow exists, transitions CONFIRMED -> NO_SHOW, and never calls Stripe", () => {
    expect(actions).toContain("export async function markAppointmentNoShow(appointmentId)");
    const fnBody = actions.slice(
      actions.indexOf("export async function markAppointmentNoShow"),
      actions.indexOf("export async function", actions.indexOf("export async function markAppointmentNoShow") + 1)
    );
    expect(fnBody).toContain('where: { id: appointmentId, status: "CONFIRMED" }');
    expect(fnBody).toContain('status: "NO_SHOW"');
    // The whole point: no refund, no payment mutation, no Stripe call.
    expect(fnBody).not.toContain("stripe.refunds.create");
    expect(fnBody).not.toContain("tx.payment.update");
    expect(fnBody).not.toContain("prisma.payment.update");
  });

  test("has its own notification type, not misrepresented as a cancellation", () => {
    expect(schema).toContain("APPOINTMENT_NO_SHOW");
    expect(actions).toContain("buildAppointmentNoShowNotification");
  });

  test("dashboard exposes a dedicated no-show action on CONFIRMED appointments, distinct from Annuler", () => {
    const drawer = source("components/dashboard/calendar/AppointmentDrawer.jsx");
    expect(drawer).toContain("markAppointmentNoShow");
    expect(drawer).toContain("handleNoShow");
    expect(drawer).toContain("Marquer absente");

    const list = source("components/dashboard/appointments/AppointmentsPageClient.jsx");
    expect(list).toContain("markAppointmentNoShow");
    expect(list).toContain("handleNoShow");
  });
});
