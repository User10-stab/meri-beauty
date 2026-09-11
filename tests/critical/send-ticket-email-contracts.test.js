import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 1f2e90b removed every client-facing send of the till-style ticket. This is
// the one deliberate reopening: a manual, permission-gated action, not a
// role check and not a restoration of the old auto-send. These contracts pin
// the authorization boundary and the audit trail at the source level, since
// a running-server test can only prove "a permitted staff member could send
// it" — it can't prove there is no OTHER path in that skips the gate.
describe("sendTicketByEmail stays a deliberate, permission-gated exception", () => {
  const action = source("actions/payments/send-ticket-email.js");

  test("is gated on the new SEND_TICKET_EMAIL permission, not a role", () => {
    expect(action).toContain("hasDashboardPermission(session.user, STAFF_PERMISSIONS.SEND_TICKET_EMAIL)");
  });

  test("never takes the recipient address from the caller — same reasoning as sendInvoiceByEmail", () => {
    expect(action).toContain("export async function sendTicketByEmail(paymentId, { transactionId = null } = {})");
    expect(action).toContain("customer?.email?.trim()");
  });

  test("shares ticket assembly with the staff reprint route instead of re-querying the payment", () => {
    expect(action).toContain('import { buildPaymentTicket } from "@/lib/cash-book/build-payment-ticket"');
    expect(action).toContain("buildPaymentTicket(paymentId, { transactionId })");
    expect(action).not.toContain("prisma.payment.findUnique");
  });

  test("treats a provider failure as a failure, never a silent success", () => {
    expect(action).toContain("sendResult.success === false");
  });

  test("records both a durable flag and an audit trail on success, not just one", () => {
    expect(action).toContain("data: { ticketEmailedAt: new Date() }");
    expect(action).toContain("AUDIT_ACTIONS.TICKET_EMAILED");
    expect(action).toContain("writeAuditLog(prisma,");
  });
});

describe("the new permission stays opt-in, not granted to every staff member by default", () => {
  const authz = source("lib/authorization.js");

  test("SEND_TICKET_EMAIL is a real permission key, listed for owners/admins to grant", () => {
    expect(authz).toContain("SEND_TICKET_EMAIL: \"SEND_TICKET_EMAIL\"");
    expect(authz).toContain("STAFF_PERMISSIONS.SEND_TICKET_EMAIL, label:");
  });

  test("it is not in DEFAULT_STAFF_PERMISSIONS — existing staff keep today's behaviour until opted in", () => {
    const defaultsIdx = authz.indexOf("export const DEFAULT_STAFF_PERMISSIONS");
    const defaults = authz.slice(defaultsIdx, authz.indexOf("]);", defaultsIdx));
    expect(defaults).not.toContain("SEND_TICKET_EMAIL");
  });
});

// 11 Sep 2026: the per-row "Envoyer" ticket-email button was dropped from the
// Livre de caisse (client's explicit ask — the journal already links each
// row's N° pièce to the ticket itself, no email action needed there). The
// capability lives only in Operations now, via TransactionDetailDrawer.
describe("the Livre de caisse has no send-ticket-by-email action", () => {
  const client = source("components/dashboard/boutique/caisse/CaisseClient.jsx");
  const page = source("app/dashboard/boutique/caisse/page.jsx");

  test("the caisse page does not compute or pass the permission", () => {
    expect(page).not.toContain("SEND_TICKET_EMAIL");
    expect(page).not.toContain("canSendTicketEmail");
  });

  test("the journal client has no send-ticket action, but still links N° pièce to the ticket", () => {
    expect(client).not.toContain("sendTicketByEmail");
    expect(client).not.toContain("canSendTicketEmail");
    expect(client).toContain("function pieceNumberHref(row)");
  });
});

describe("Operations keeps the send action, permission-gated the same way", () => {
  const actions = source("actions/dashboard/admin-operations.js");
  const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");

  test("the transaction detail data computes the permission server-side", () => {
    expect(actions).toContain("hasDashboardPermission(");
    expect(actions).toContain("STAFF_PERMISSIONS.SEND_TICKET_EMAIL");
    expect(actions).toContain("canSendTicketEmail,");
  });

  test("the drawer only renders the action under that flag", () => {
    expect(drawer).toContain("detail.canSendTicketEmail");
    expect(drawer).toContain("sendTicketByEmail(paymentId)");
  });
});
