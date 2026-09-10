import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 9 Sep 2026 — client decision: the Livre de caisse (Belgium's livre de
// recettes) must contain only cash movements owned by Marie
// (contact@meribeautystudio.com on prod) or an OWNER/ADMIN. Every other staff
// member still settles bookings and rings up sales — their cash collection is
// recorded "off-till" (no cash-session link, no piece number, no attestation,
// no open-till requirement), so it shows in Opérations but never in the
// drawer's book or its X/Z reconciliation, and the "espèces / carte" popup is
// hidden from them.

describe("the till-cash-operator helper", () => {
  const auth = source("lib/authorization.js");

  test("is exported, admin-inclusive, and env-overridable with the prod default", () => {
    expect(auth).toContain("export function isTillCashOperator(user)");
    expect(auth).toContain("if (isAdminRole(user.role)) return true");
    expect(auth).toContain("process.env.TILL_CASH_OPERATOR_EMAIL");
    expect(auth).toContain('"contact@meribeautystudio.com"');
    // Case-insensitive match against the session e-mail.
    expect(auth).toContain("user.email.toLowerCase() === TILL_CASH_OPERATOR_EMAIL");
  });
});

describe("every on-site money path branches on it", () => {
  // file, the expression that decides the actor is off-till
  test.each([
    ["lib/reservations/settle-reservation.js", "const offTill = !isTillCashOperator(actor)"],
    ["actions/appointment/manage-appointment.js", "const offTill = !isTillCashOperator(authCheck.user)"],
    ["actions/boutique/point-of-sale.js", "const offTill = !isTillCashOperator(guard.session.user)"],
    ["actions/counter/create-reservation.js", "const offTill = !isTillCashOperator(guard.session.user)"],
    ["actions/boutique/orders.js", "const offTill = !isTillCashOperator(guard.session.user)"],
  ])("%s decides off-till from the acting user", (file, expr) => {
    const content = source(file);
    expect(content).toMatch(/import \{[^}]*\bisTillCashOperator\b[^}]*\} from "@\/lib\/authorization"/);
    expect(content).toContain(expr);
  });

  test("the two reservation wrappers forward the acting user to settleReservation", () => {
    for (const file of ["actions/workshops/manage-reservation.js", "actions/formations/manage-reservation.js"]) {
      expect(source(file)).toContain("actor: session.user,");
    }
  });
});

describe("an off-till collection is detached from the Livre de caisse", () => {
  test.each([
    ["lib/reservations/settle-reservation.js", 'const useTill = !offTill && method === "CASH"'],
    ["actions/appointment/manage-appointment.js", 'const useTill = !offTill && method === "CASH"'],
    ["actions/boutique/point-of-sale.js", 'const useTill = !offTill && method === "CASH"'],
    ["actions/counter/create-reservation.js", 'const useTill = !offTill && data.payment.method === "CASH"'],
    ["actions/boutique/orders.js", 'const useTill = !offTill && method === "CASH"'],
  ])("%s only tags the session / piece number when a till operator takes cash", (file, expr) => {
    const content = source(file);
    expect(content).toContain(expr);
    // The cash-book queries (lib/cash-book/*) filter on cashSessionId AND a
    // non-null pieceNumber — an off-till row has neither.
    expect(content).toMatch(/cashSessionId: useTill \? openCashSession\.id : null|cashSessionId: openCashSession\?\.id \?\? null/);
    expect(content).toContain("useTill ? await allocatePieceNumber");
  });

  test("the caisse routes are only revalidated for a till operator's cash", () => {
    for (const file of [
      "lib/reservations/settle-reservation.js",
      "actions/appointment/manage-appointment.js",
      "actions/counter/create-reservation.js",
    ]) {
      const content = source(file);
      expect(content, `${file} still revalidates the caisse for an off-till collection`).not.toMatch(
        /if \(\s*(result\.balance > 0 && )?method === "CASH"\s*\) revalidateCaisseRoutes/,
      );
    }
  });
});

describe("the settlement UIs hide the espèces / carte popup for a non-operator", () => {
  test("the page/route components compute canCollectCash from isTillCashOperator", () => {
    for (const file of [
      "app/dashboard/workshops/reservations/page.jsx",
      "app/dashboard/formations/reservations/page.jsx",
      "app/dashboard/appointments/page.jsx",
      "app/dashboard/calendrier/page.jsx",
      "app/(dashboard)/dashboard/boutique/point-of-sale/page.jsx",
    ]) {
      expect(source(file)).toContain("isTillCashOperator(");
    }
  });

  test("SettleReservationDialog collapses to a plain confirmation off-till", () => {
    const dialog = source("components/dashboard/reservations/SettleReservationDialog.jsx");
    expect(dialog).toContain("canCollectCash = true");
    expect(dialog).toContain("const hasBalance = balance > 0 && canCollectCash");
    expect(dialog).toContain("onConfirm({})");
  });

  test("the counter settle action drops the method picker off-till", () => {
    const fiche = source("components/dashboard/boutique/counter/FicheSettleAction.jsx");
    expect(fiche).toContain("const takesMoneyAtTill = canCollectCash && amountDue > 0");
    expect(fiche).toContain("{takesMoneyAtTill && (");
  });

  test("the calendar drawer skips its payment dialog off-till", () => {
    const drawer = source("components/dashboard/calendar/AppointmentDrawer.jsx");
    expect(drawer).toContain("if (canCollectCash && appointmentCollectsAtCounter(appointment))");
  });
});
