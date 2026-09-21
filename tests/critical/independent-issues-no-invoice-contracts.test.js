import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTillCashOperator, TILL_CASH_OPERATOR_EMAIL } from "@/lib/authorization";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * An invoice carries the salon's name and VAT number. Every practitioner at
 * Meri Beauty is legally independent and invoices her own sales under her
 * own number, so the salon must not issue one on her behalf — the same rule
 * the ticket series already follows (ticket-numbering-contracts.test.js).
 *
 * Marie Mercier is the exception that makes a role check useless: her role is
 * STAFF, and her VAT number IS the salon's. Every guard below therefore keys
 * on isTillCashOperator(), never on a role, an e-mail literal, or
 * Staff.type === "INDEPENDENT".
 *
 * These are source-level contracts on purpose. A running-server test can show
 * that one permitted actor gets an invoice; it cannot show there is no OTHER
 * path in that skips the check — and "someone adds a fifth issueInvoice call
 * and forgets the flag" is exactly how this breaks.
 */

// Reachable by a STAFF session, and about a sale that may be hers.
const STAFF_REACHABLE = [
  "actions/boutique/point-of-sale.js",
  "actions/boutique/orders.js",
  "actions/counter/create-reservation.js",
  "actions/appointment/manage-appointment.js",
  "lib/orders/fulfill-order-payment.js",
  "lib/reservations/settle-reservation.js",
];

// Admin-only, and about the salon's OWN events (ateliers, formations), which
// carry no staff link in the schema at all. An invoice here is the salon's
// document for the salon's own sale, which is correct.
const ADMIN_ONLY = [
  ["actions/formations/manage-reservation.js", "cancelFormationReservation"],
  ["actions/formations/manage-reservation.js", "changeFormationReservationSession"],
  ["actions/workshops/manage-reservation.js", "cancelWorkshopReservation"],
  ["actions/workshops/manage-reservation.js", "changeReservationSession"],
];

// The actor flag, however each file spells it.
const ACTOR_GUARD = /offTill|offTillActor|isStaffActor|canIssue/;

/**
 * The one staff-reachable action whose invoice is NOT actor-gated, and does
 * not need to be: rejectAppointment only invoices a FORFEITED deposit, which
 * presupposes money already collected, and a paid appointment can only be
 * cancelled by an admin ("Seul un administrateur peut annuler un rendez-vous
 * déjà payé"). A staff member reaching this action has an unpaid appointment,
 * a zero forfeit, and no invoice. Listed explicitly so the scan below stays
 * strict for everything else.
 */
const ADMIN_GATED_SITES = new Set(["rejectAppointment"]);

/** The nearest `function name(` at or above a line. */
function enclosingFunction(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const m = lines[i].match(/^(?:export )?async function (\w+)\s*\(/);
    if (m) return m[1];
  }
  return null;
}

function issueInvoiceLines(code) {
  return code
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => {
      const t = line.trim();
      return line.includes("issueInvoice(") && !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    });
}

describe("une indépendante n'émet aucune facture au nom du salon", () => {
  test.each(STAFF_REACHABLE)("%s gates every issueInvoice() on the acting account", (path) => {
    const code = source(path);
    const lines = code.split("\n");
    const calls = issueInvoiceLines(code);
    // If this drops to zero the file was refactored and this contract is
    // silently testing nothing.
    expect(calls.length, `no issueInvoice() call left in ${path}`).toBeGreaterThan(0);

    for (const { index } of calls) {
      const fnName = enclosingFunction(lines, index);
      if (ADMIN_GATED_SITES.has(fnName)) continue;
      // Comments must not count. Every one of these call sites carries a
      // comment explaining the offTill rule, so scanning the raw text let a
      // deleted `&& !offTill` pass on the strength of the paragraph above it
      // still describing the guard that was just removed.
      const preceding = lines
        .slice(Math.max(0, index - 25), index)
        .map((line) => line.replace(/\/\/.*$/, ""))
        .filter((line) => !/^\s*[*/]/.test(line))
        .join("\n");
      expect(
        ACTOR_GUARD.test(preceding),
        `issueInvoice() at ${path}:${index + 1} (in ${fnName}) has no actor guard in the 25 lines above it`
      ).toBe(true);
    }
  });

  test("rejectAppointment's invoice is unreachable without an admin, which is what makes it safe", () => {
    const code = source("actions/appointment/manage-appointment.js");
    // Both halves matter. Only a forfeited deposit is invoiced here...
    expect(code).toContain("if (forfeitAmount > REFUND_EPSILON && !payment.invoice");
    // ...and a deposit exists only on a paid appointment, which only an
    // admin may cancel. Remove either and a staff member gets an invoice.
    expect(code).toContain("if (wasPaid) {");
    expect(code).toContain("if (!isAdminRole(session?.user?.role)) {");
  });

  test.each(STAFF_REACHABLE)("%s derives that flag from isTillCashOperator, not from a role", (path) => {
    const code = source(path);
    const declarations = code.match(/const (offTill|offTillActor|isStaffActor)\s*=.*/g) ?? [];
    expect(declarations.length, `${path} declares no actor flag`).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration, `${path}: "${declaration.trim()}"`).toContain("isTillCashOperator");
    }

    // The three ways this gets broken, each of which excludes Marie.
    const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, path).not.toContain('role === "STAFF"');
    expect(stripped, path).not.toContain('type: "INDEPENDENT"');
    expect(stripped, path).not.toContain(TILL_CASH_OPERATOR_EMAIL);
  });

  test.each(ADMIN_ONLY)("%s :: %s() stays admin-only, so no staff reaches its invoice", (path, fnName) => {
    const lines = source(path).split("\n");
    const start = lines.findIndex((line) => line.includes(`function ${fnName}(`));
    expect(start, `${fnName} not found in ${path}`).toBeGreaterThan(-1);
    // The guard sits at the top of the action, before any work.
    const head = lines.slice(start, start + 45).join("\n");
    expect(head, `${fnName} has no isAdminRole guard`).toContain("isAdminRole");
  });

  test("Marie keeps issuing invoices; another independent does not", () => {
    // She fails every role test — that is the point — and passes the only
    // predicate the guards above actually consult.
    expect(isTillCashOperator({ role: "STAFF", email: TILL_CASH_OPERATOR_EMAIL })).toBe(true);
    expect(isTillCashOperator({ role: "ADMIN", email: "admin@meribeauty.com" })).toBe(true);
    expect(isTillCashOperator({ role: "STAFF", email: "julieschoemans@gmail.com" })).toBe(false);
    expect(isTillCashOperator({ role: "STAFF", email: "lylyht.mylitha@gmail.com" })).toBe(false);
  });

  test("the salon may still invoice the practitioners themselves", () => {
    // Contract/rent billing runs the other way round: the salon is the
    // seller and the independent is the customer. Gating it on the actor
    // would stop the salon invoicing its own tenants — the opposite of what
    // this whole rule is for.
    // Since 2026-09-21 the rent due is recorded without an invoice
    // (lib/staff-monthly-billing.js, lib/staff-invoice.js) and the invoice is
    // issued when an admin accepts the transfer (actions/invoices/staff-rent.js).
    const billing = source("lib/staff-monthly-billing.js");
    const contract = source("lib/staff-invoice.js");
    const accept = source("actions/invoices/staff-rent.js");
    expect(billing).toContain("createPendingRent(tx, {");
    expect(contract).toContain("createPendingRent(tx, {");
    expect(issueInvoiceLines(accept).length).toBeGreaterThan(0);
    expect(billing + contract + accept).not.toContain("isTillCashOperator");
  });
});
