import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Deposit forfeiture on a late cancellation defaults to 100% — the deposit
// is kept in full on a late cancellation, matching what customers are told
// (MyAppointmentsPageClient.jsx / MyReservationsClient.jsx: "L'acompte reste
// acquis... sauf annulation exceptionnelle approuvée par l'administration")
// and the same non-refundable-by-default policy already applied to
// ateliers/formations deposits. The only way back to a full refund is an
// admin approving a cancellation-exception request, which passes
// waiveDepositForfeit: true — see
// actions/appointment/manage-appointment.js's rejectAppointment.
describe("deposit forfeiture defaults to withholding the deposit in full", () => {
  const schema = source("prisma/schema.prisma");
  const actions = source("actions/appointment/manage-appointment.js");

  test("Staff.depositForfeitPercentage defaults to 100", () => {
    expect(schema).toContain("depositForfeitPercentage");
    expect(schema).toMatch(/depositForfeitPercentage\s+Decimal\s+@default\(100\)/);
  });

  test("only applies to a deposit-type payment inside the cancellation window, never a full/balance payment", () => {
    expect(actions).toContain('payment.paymentType === "DEPOSIT"');
    expect(actions).toContain("isWithinCancellationWindow(appointment.startTime)");
    expect(actions).toContain("forfeitPercentage > 0");
  });

  test("does not withhold a deposit when the assigned staff member cancels", () => {
    expect(actions).toContain("const cancelledByAssignedStaff = authCheck.userRole === ROLES.STAFF");
    expect(actions).toContain("!isAdminRole(session?.user?.role) && !cancelledByAssignedStaff");
    expect(actions).toContain("!cancelledByAssignedStaff");
  });

  test("forfeiture is computed before pinning the refund, so the pinned/refunded amount already excludes it", () => {
    const forfeitIdx = actions.indexOf("let forfeitAmount = 0");
    const needsRefundIdx = actions.indexOf("const needsRefund =");
    expect(forfeitIdx).toBeGreaterThan(-1);
    expect(needsRefundIdx).toBeGreaterThan(forfeitIdx);
  });

  test("does not apply to no-show handling, which withholds everything by design instead", () => {
    const noShowFn = actions.slice(
      actions.indexOf("export async function markAppointmentNoShow"),
      actions.indexOf("export async function", actions.indexOf("export async function markAppointmentNoShow") + 1)
    );
    expect(noShowFn).not.toContain("depositForfeitPercentage");
  });
});
