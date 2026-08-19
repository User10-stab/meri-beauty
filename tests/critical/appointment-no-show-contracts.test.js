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
describe("marking an appointment as a no-show never refunds Payment", () => {
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
    // The whole point: no refund, no Stripe call, ever, in either direction.
    // (H14 fix: the forfeited deposit IS finally, non-refundably realized
    // revenue at this point, so the function now does mark Payment PAID and
    // issue an invoice for it — see the tx.payment.update below — but that's
    // settlement/invoicing, never a refund.)
    expect(fnBody).not.toContain("stripe.refunds.create");
    expect(fnBody).toContain("tx.payment.update");
    expect(fnBody).toContain('status: "PAID"');
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

// rejectAppointment's status list includes NO_SHOW (to let staff close out
// the calendar entry afterward), but its forfeit block used to only trigger
// for payment.paymentType === "DEPOSIT" — a FULL_ONLINE no-show fell through
// that check and got refunded in full, silently undoing the "never refunds"
// guarantee markAppointmentNoShow just made above.
describe("cancelling an already-recorded no-show never refunds it either", () => {
  const actions = source("actions/appointment/manage-appointment.js");

  test("rejectAppointment forfeits the full remaining amount for a NO_SHOW, regardless of paymentType", () => {
    expect(actions).toContain('const isNoShowClosure = appointment.status === "NO_SHOW"');

    const rejectStart = actions.indexOf("export async function rejectAppointment");
    const forfeitIdx = actions.indexOf("let forfeitAmount = 0", rejectStart);
    const noShowBranchIdx = actions.indexOf("if (wasPaid && isNoShowClosure)", forfeitIdx);
    const needsRefundIdx = actions.indexOf("const needsRefund =", forfeitIdx);

    expect(forfeitIdx).toBeGreaterThan(rejectStart);
    expect(noShowBranchIdx).toBeGreaterThan(forfeitIdx);
    expect(noShowBranchIdx).toBeLessThan(needsRefundIdx);

    // It must run before, and independently of, the DEPOSIT-only branch —
    // not be gated by payment.paymentType === "DEPOSIT" itself.
    const branchBody = actions.slice(noShowBranchIdx, actions.indexOf("} else if (", noShowBranchIdx));
    expect(branchBody).not.toContain('paymentType === "DEPOSIT"');
    expect(branchBody).toContain("forfeitAmount = remaining");
    expect(branchBody).toContain("remaining = 0");
  });
});
