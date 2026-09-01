import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Normalized to LF — core.autocrlf=true with no .gitattributes flips files to
// CRLF in the working tree whenever git touches them, silently breaking the
// multi-line matches below.
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 24 Aug 2026: an appointment balance paid in cash created a Transaction with
// method CASH but no cashSessionId, so it never entered the till total. Every
// close showed the drawer holding more than expected, with nothing explaining
// the difference. The three other on-site money paths already did this.
describe("every on-site payment lands in the open till session", () => {
  // POS is deliberately excluded here — see "the counter sale uniquely
  // refuses to run with no till open" below: every other on-site path still
  // leaves the row unassigned rather than block a payment already promised.
  test.each([
    ["actions/appointment/manage-appointment.js", "appointment balance"],
    ["lib/reservations/settle-reservation.js", "atelier/formation balance"],
    ["actions/boutique/orders.js", "order pickup"],
    ["actions/boutique/returns.js", "cash refund"],
  ])("%s attaches the open cash session", (file) => {
    const content = source(file);
    expect(content).toContain("cashSessionId: openCashSession?.id ?? null");
    // Format-agnostic: the POS wraps the same call across lines. What must
    // hold is that it looks up the *open* session, not how it is indented.
    expect(content).toMatch(/cashSession\.findFirst\(\{\s*where: \{ closedAt: null \}/);
  });

  test("the appointment path only looks up a session for cash, not for card", () => {
    const content = source("actions/appointment/manage-appointment.js");
    // A card payment goes through the terminal's own reconciliation; putting
    // it in the drawer total would invent a variance rather than remove one.
    expect(content).toContain('method === "CASH"\n            ? await tx.cashSession.findFirst');
  });

  test("a missing session never blocks the payment", () => {
    // Refusing to take a customer's money because nobody opened the till
    // would be a worse failure than an unassigned row.
    expect(source("actions/appointment/manage-appointment.js")).toContain(
      "cashSessionId: openCashSession?.id ?? null"
    );
  });

  // 1 Sep 2026: unlike every other on-site path, the counter POS refuses to
  // ring up anything — any payment method, not just cash — with no till
  // session open. Checked twice: once before the transaction (fast-path,
  // avoids doing all the writes just to abort), and again inside it
  // (authoritative — with staff on multiple terminals, the session can close
  // in the gap between the two reads).
  test("the counter sale uniquely refuses to run with no till open, whatever the payment method", () => {
    const pos = source("actions/boutique/point-of-sale.js");
    expect(pos).toContain("const openCashSessionGate = await prisma.cashSession.findFirst({ where: { closedAt: null }");
    expect(pos).toContain("requiresCashSession: true");
    expect(pos).toContain('if (!openCashSession) throw new Error("POS_CASH_SESSION_CLOSED")');
    expect(pos).toContain('if (error.message === "POS_CASH_SESSION_CLOSED")');
    // Only a CASH row belongs to the till total, even though a session is
    // now required for every method — see the cash-book queries, which all
    // filter on method: "CASH" alongside cashSessionId.
    expect(pos).toContain('cashSessionId: method === "CASH" ? openCashSession.id : null');
  });
});

describe("the till lists what is still owed without re-implementing settlement", () => {
  const action = source("actions/boutique/settlements.js");

  test("it records no money of its own", () => {
    // The whole point is that the invoice, the receipt e-mail, the cash
    // session and the atomic status claim stay in the three actions that
    // already owned them. A second implementation here would drift.
    expect(action).not.toContain("issueInvoice");
    expect(action).not.toContain("transaction.create");
    expect(action).not.toContain("payment.update");
    expect(action).not.toContain("$transaction");
  });

  test("the panel settles through those same actions", () => {
    const panel = source("components/dashboard/boutique/CounterPanel.jsx");
    expect(panel).toContain('import { completeAppointment } from "@/actions/appointment/manage-appointment"');
    expect(panel).toContain('import { completeWorkshopReservation } from "@/actions/workshops/manage-reservation"');
    expect(panel).toContain('import { completeFormationReservation } from "@/actions/formations/manage-reservation"');
  });

  test("running the till is not enough — each kind needs its own permission", () => {
    expect(action).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.POINT_OF_SALE)");
    expect(action).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS)");
    expect(action).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS)");
    expect(action).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS)");
    expect(action).toContain("scope.canAppointments");
    expect(action).toContain("scope.canWorkshops");
    expect(action).toContain("scope.canFormations");
  });

  test("a STAFF member sees only their own calendar, mirroring authorizeAppointmentAction", () => {
    // Listing another practitioner's rendez-vous would leak the customer name
    // and the amount owed even though the settle call would then refuse it.
    expect(action).toContain("ownStaffId = await getStaffId(session)");
    expect(action).toContain("...(scope.ownStaffId ? { staffId: scope.ownStaffId } : {})");
  });

  test("the empty search is today's agenda while a name may span dates", () => {
    expect(action).toContain("function todayWindow()");
    expect(action).toContain("const dateFilter = value ? undefined : todayWindow()");
    expect(action).toContain("...(dateFilter ? { startTime: dateFilter } : {})");
    expect(action).toContain("...(dateFilter ? { session: { startDate: dateFilter } } : {})");
  });

  test("confirmed bookings stay searchable even when no balance is due", () => {
    // The list now serves check-in as well as settlement, so a paid-in-full
    // ticket must not disappear merely because remainingAmount is zero.
    expect(action).toContain('status: "CONFIRMED"');
    expect(action).toContain("balanceDue: Number(appointment.payment?.remainingAmount ?? 0)");
    expect(action).not.toContain("remainingAmount: { gt: 0 }");
  });

  test("a deleted payment is never chased", () => {
    expect(action).toContain("isDeleted: false");
  });
});

describe("nothing is marked paid before the money is in hand", () => {
  const panel = source("components/dashboard/boutique/CounterPanel.jsx");

  test("the settle call carries the staff attestation", () => {
    expect(panel).toContain("paymentConfirmed: true");
  });

  test("the button is disabled until the cashier ticks that they received it", () => {
    // Nothing in the system can observe a cash handoff or a terminal's
    // "APPROUVÉ" screen — same guard as the POS terminal sale.
    expect(panel).toContain("disabled={!received || saving || (isExternalTerminal && (!terminalApproved || !terminalReference.trim()))}");
    expect(panel).toContain("J&apos;ai bien reçu {formatPrice(ticket.balanceDue)}");
  });

  test("the Pointage settlement panel supports an external terminal reference", () => {
    expect(panel).toContain('"EXTERNAL_TERMINAL"');
    expect(panel).toContain("Terminal APPROUVÉ");
    expect(panel).toContain("terminalReference: terminalReference.trim()");
  });

  test("a refused settlement surfaces its reason instead of silently succeeding", () => {
    expect(panel).toContain("if (!result.success)");
    expect(panel).toContain("toast.error(result.message)");
  });

  test("a settled row leaves the list so it cannot be collected twice", () => {
    expect(panel).toContain("onChanged()");
  });

  test("a slow response cannot overwrite a newer search", () => {
    expect(panel).toContain("if (requestRef.current !== requestId) return;");
  });
});

describe("the till panel is hidden from whoever cannot settle anything", () => {
  test("the page checks all three capabilities before rendering it", () => {
    const page = source("app/(dashboard)/dashboard/boutique/point-of-sale/page.jsx");
    expect(page).toContain("canSettle={canAppointments || canWorkshops || canFormations}");
    // Otherwise the cashier reads "tout est encaissé" on a list they are
    // simply not allowed to see — worse than no panel at all.
    expect(page).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS)");
    expect(page).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS)");
    expect(page).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.FORMATION_RESERVATIONS)");
  });
});
