import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Deposit forfeiture on a late cancellation was entirely absent — every
// cancellation path always refunded 100%, regardless of policy. This wires
// in a configurable withholding, defaulted to 0% (today's exact behaviour)
// so nothing changes for anyone until a staff member's percentage is set
// above zero — see actions/appointment/manage-appointment.js's rejectAppointment.
describe("deposit forfeiture is inert at its 0% default", () => {
  const schema = source("prisma/schema.prisma");
  const actions = source("actions/appointment/manage-appointment.js");

  test("Staff.depositForfeitPercentage defaults to 0", () => {
    expect(schema).toContain("depositForfeitPercentage");
    expect(schema).toMatch(/depositForfeitPercentage\s+Decimal\s+@default\(0\)/);
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
