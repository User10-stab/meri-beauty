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
// the difference. Fixed by attaching whichever session happened to be open —
// but "attach one if it exists" still allowed a session to be missing
// entirely. An 8 Sep 2026 audit of the dev database's own Livre de caisse
// caught exactly that: three real appointment payments taken before that
// day's till was ever opened, permanently invisible from every session's book
// (Transaction.cashSessionId is written once and never backfilled). Rather
// than reverting to a flat refusal — appointment/atelier-formation/order-
// pickup settlement deliberately never turn away a payment already promised —
// each of the three now gates cash behind a one-click, same-screen "ouvrir la
// caisse" (see CashSessionGate.jsx): the server still refuses authoritatively
// if none is open, but the UI never lets that refusal actually interrupt a
// real customer, since opening a till is a two-second, same-screen step.
describe("every on-site payment lands in the open till session, or is refused until one is", () => {
  // The three settlement paths for an *already-existing* obligation — a
  // rendez-vous, an atelier/formation balance, an order pickup. Cash refunds
  // (actions/boutique/returns.js, see below) are deliberately excluded: this
  // gate protects against creating an unreconcilable cash *sale*, not against
  // giving money back, which the plan never touched.
  test.each([
    ["actions/appointment/manage-appointment.js", "APPOINTMENT_CASH_SESSION_CLOSED"],
    ["lib/reservations/settle-reservation.js", "RESERVATION_CASH_SESSION_CLOSED"],
    ["actions/boutique/orders.js", "PICKUP_CASH_SESSION_CLOSED"],
  ])("%s refuses a cash collection with no till open, and attaches the real session otherwise", (file, errorCode) => {
    const content = source(file);
    expect(content).toContain('cashSessionId: method === "CASH" ? openCashSession.id : null');
    expect(content, "no authoritative in-transaction refusal").toContain(`throw new Error("${errorCode}")`);
    expect(content, "the thrown error is never mapped back to a user-facing refusal").toContain(`if (error.message === "${errorCode}")`);
    expect(content).toContain("requiresCashSession: true");
    // Format-agnostic: what must hold is that it looks up the *open* session,
    // not how the lookup happens to be indented.
    expect(content).toMatch(/cashSession\.findFirst\(\{\s*where: \{ closedAt: null \}/);
  });

  test("the appointment path only looks up a session for cash, not for card", () => {
    const content = source("actions/appointment/manage-appointment.js");
    // A card payment goes through the terminal's own reconciliation; putting
    // it in the drawer total would invent a variance rather than remove one.
    expect(content).toContain('method === "CASH"\n            ? await tx.cashSession.findFirst');
  });

  // The one on-site cash path that still never blocks — giving a customer's
  // money back is not the risk this gate exists to prevent.
  test("a cash refund still never blocks on a missing session", () => {
    expect(source("actions/boutique/returns.js")).toContain(
      "cashSessionId: openCashSession?.id ?? null"
    );
  });

  // 1 Sep 2026: the counter POS refuses to ring up anything — any payment
  // method, not just cash — with no till session open; the three settlement
  // paths above later adopted the same shape for CASH specifically. Checked
  // twice: once before the transaction (fast-path, avoids doing all the
  // writes just to abort), and again inside it (authoritative — with staff on
  // multiple terminals, the session can close in the gap between the two
  // reads).
  test("the counter sale (new bookings, retail till) refuses to run with no till open, whatever the payment method", () => {
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

  test("the new counter booking creation gates cash the same way", () => {
    const create = source("actions/counter/create-reservation.js");
    expect(create).toContain('if (!openCashSession) throw new Error("CASH_SESSION_REQUIRED")');
    expect(create).toContain('if (error.message === "CASH_SESSION_REQUIRED")');
    expect(create).toContain("requiresCashSession: true");
  });
});

// 8 Sep 2026: closing the gap above only helps if staff actually see it in
// time to fix it — a passive warning they could click past (the previous
// design) still let the exact same orphaned-row bug happen, it just also
// showed a sentence nobody was required to read. CashSessionGate.jsx replaces
// that warning with a one-click "ouvrir la caisse" that disables the
// settle/collect button until it resolves, wired into every screen a CASH
// radio can be selected on.
describe("a CASH selection with no till open blocks submission until resolved inline", () => {
  test.each([
    ["components/dashboard/boutique/counter/FicheSettleAction.jsx", "settle"],
    ["components/dashboard/boutique/counter/PickupFiche.jsx", "pickup"],
    ["components/dashboard/boutique/counter/CounterBookingComposer.jsx", "composer"],
  ])("%s renders the inline gate instead of a passive warning", (file) => {
    const content = source(file);
    expect(content).toContain('import { CashSessionGate } from "@/components/dashboard/boutique/counter/CashSessionGate"');
    expect(content).toContain("<CashSessionGate onOpened={markCashSessionOpen}");
    // The old warning-only paragraph must actually be gone, not merely
    // supplemented — otherwise staff see both and the gate reads as optional.
    expect(content, "the passive, non-blocking warning text should have been replaced").not.toContain(
      "cet encaissement en espèces n&apos;apparaîtra jamais dans le Livre de caisse",
    );
  });

  test("useCashSessionOpen exposes a way to reflect an inline open immediately", () => {
    const hook = source("components/dashboard/boutique/counter/useCashSessionOpen.js");
    expect(hook).toContain("markOpen");
    expect(hook).toContain("markClosed");
  });

  test("a server refusal (a session closed in the race window) re-shows the gate instead of just erroring", () => {
    for (const file of [
      "components/dashboard/boutique/counter/FicheSettleAction.jsx",
      "components/dashboard/boutique/counter/PickupFiche.jsx",
      "components/dashboard/boutique/counter/CounterBookingComposer.jsx",
    ]) {
      expect(source(file)).toContain("if (result.requiresCashSession) markCashSessionClosed();");
    }
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
    // These three imports moved from CounterPanel.jsx into the standalone
    // settle-action component when the counter split into one file per piece.
    const settleAction = source("components/dashboard/boutique/counter/FicheSettleAction.jsx");
    expect(settleAction).toContain('import { completeAppointment } from "@/actions/appointment/manage-appointment"');
    expect(settleAction).toContain('import { completeWorkshopReservation } from "@/actions/workshops/manage-reservation"');
    expect(settleAction).toContain('import { completeFormationReservation } from "@/actions/formations/manage-reservation"');
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
  // FicheSettleAction.jsx is CounterPanel's old inline SettleAction,
  // extracted to its own file when the counter split into one file per piece.
  const panel = source("components/dashboard/boutique/counter/FicheSettleAction.jsx");

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
    expect(panel).toContain("saving ||");
    expect(panel).toContain("(priceChanged && adjustmentReason.trim().length < 3) ||");
    expect(panel).toContain('(amountDue > 0 && isExternalTerminal && !terminalReference.trim()) ||');
    // 8 Sep 2026: a fourth clause — cash cannot be confirmed while no till is
    // open either, same principle as the price/terminal-reference guards.
    expect(panel).toContain('(amountDue > 0 && method === "CASH" && !cashSessionOpen)');
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
    // The race-guard lives in CounterSurface now — it owns all three
    // lookup/search calls (code lookup, name search, select-a-result) so
    // they keep sharing one requestRef instead of racing each other.
    const surface = source("components/dashboard/boutique/counter/CounterSurface.jsx");
    expect(surface).toContain("if (requestRef.current !== requestId) return;");
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
