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
    expect(action).toContain("balanceDue: Number(appointment.payment?.remainingAmount ?? appointment.staffService?.price ?? 0)");
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

  test("the confirm button is itself the attestation, and names the amount", () => {
    // Nothing in the system can observe a cash handoff or a terminal's
    // "APPROUVÉ" screen — same guard as the POS terminal sale. What changed is
    // where a human says the money arrived: it used to be a checkbox sitting
    // next to the confirm button, which is a tick people learn to click past
    // on their way to the thing they actually wanted. It is now the button
    // label, so the single deliberate act names the sum being attested to.
    //
    // The wording is asserted, not merely the presence of a button, because a
    // label that stopped naming the amount would quietly turn an attestation
    // back into a "next" button.
    expect(panel).toContain("J'ai bien reçu ${formatPrice(amountDue)} — encaisser et facturer");
    expect(panel).toContain("paymentConfirmed: true");
    // And the ceremony that used to hide the form is gone: no disclosure
    // toggle, no separate tick. Re-adding either would put the clicks back.
    expect(panel).not.toContain("checked={received}");
    expect(panel).not.toContain("Encaisser ce solde");
  });

  test("a changed price cannot be confirmed without a reason", () => {
    // The price field is always visible now rather than hidden behind its own
    // toggle, so the guard that matters moved into the button: typing a new
    // total disables confirmation until a reason is given. The server refuses
    // the same way (resolveCounterPriceAdjustment), so this is the screen
    // agreeing with it rather than the only thing standing in the way.
    expect(panel).toContain(
      "disabled={saving || (priceChanged && adjustmentReason.trim().length < 3) || (amountDue > 0 && isExternalTerminal && !terminalReference.trim())}",
    );
    expect(source("lib/payments/counter-price-adjustment.js")).toContain(
      "Indiquez la raison de l'ajustement de prix.",
    );
  });

  test("a card collection cannot be recorded without the terminal's receipt reference", () => {
    // Card is EXTERNAL_TERMINAL only now: bare "CARD" was accepted with no
    // evidence at all, and of 29 card collections in the dev database exactly
    // one carried a reference — so 28 could not be reconciled against the
    // terminal's end-of-day batch. Cash at least has a piece number and an
    // open till session behind it.
    expect(panel).toContain('"EXTERNAL_TERMINAL"');
    expect(panel).toContain("terminalReference: terminalReference.trim()");
    expect(panel).toContain('{value === "CASH" ? "Espèces" : "Carte — terminal"}');
    expect(panel, "a card option with no reference came back").not.toContain(
      '"CASH", "CARD", "EXTERNAL_TERMINAL"',
    );

    // The separate "Terminal APPROUVÉ" tick is deliberately gone: for a card,
    // being paid IS the terminal approving, and the confirm button already
    // states "j'ai bien reçu X". One attestation, one piece of evidence —
    // the reference, which is the evidence, stays required.
    expect(panel).not.toContain("Terminal APPROUVÉ");
    expect(panel).toContain("terminalApproved: true");
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
