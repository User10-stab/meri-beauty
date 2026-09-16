import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 1f2e90b removed every client-facing send of the till-style ticket. This is
// the one deliberate reopening: a manual, gated action, not a plain role
// check and not a restoration of the old unconditional auto-send. These
// contracts pin the authorization boundary and the audit trail at the source
// level, since a running-server test can only prove "a permitted staff
// member could send it" — it can't prove there is no OTHER path in that
// skips the gate.
//
// 14 Sep 2026 — briefly hardcoded the same way as the till cash operator
// (isTillCashOperator): admins/owners always pass, plus exactly one staff
// account. Reverted the same day, back to a grantable permission.
//
// 16 Sep 2026 — hardcoded again, and this time on purpose. A ticket carries
// the salon's name and VAT number; every practitioner here is legally
// independent and documents her own sales under her own VAT number, so only
// the salon's own accounts may put one in a client's inbox. Dropping
// SEND_TICKET_EMAIL from DEFAULT_STAFF_PERMISSIONS is necessary but nowhere
// near sufficient — every staff account created before today still carries
// the key in Staff.dashboardPermissions, so a permission check would hand it
// straight back. See canSendTicketEmail() in lib/authorization.js.
describe("sendTicketByEmail stays a deliberate, gated exception", () => {
  const action = source("actions/payments/send-ticket-email.js");

  test("is gated on canSendTicketEmail(), awaited since the permission check is async", () => {
    expect(action).toContain("await canSendTicketEmail(session.user)");
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

describe("ticket-sending belongs to the salon, not to whoever holds a permission", () => {
  const authz = source("lib/authorization.js");

  test("canSendTicketEmail is the salon predicate, not a dashboard-permission lookup", () => {
    expect(authz).toContain("export async function canSendTicketEmail(user)");
    expect(authz).toContain("return isAdminRole(user.role) || isTillCashOperator(user);");
    // The stored permission key is what would otherwise have re-opened this
    // for every staff account created while it was still a default.
    expect(authz).not.toContain("hasDashboardPermission(user, STAFF_PERMISSIONS.SEND_TICKET_EMAIL)");
  });

  test("Marie passes on the operator predicate alone, and another independent does not", async () => {
    const { canSendTicketEmail, TILL_CASH_OPERATOR_EMAIL } = await import("@/lib/authorization");

    // Role STAFF — an isAdminRole test on its own would lock the salon out of
    // its own documents, which is exactly the mistake this guards against.
    await expect(canSendTicketEmail({ role: "STAFF", email: TILL_CASH_OPERATOR_EMAIL })).resolves.toBe(true);
    await expect(canSendTicketEmail({ role: "ADMIN", email: "admin@meribeauty.com" })).resolves.toBe(true);
    await expect(canSendTicketEmail({ role: "STAFF", email: "julieschoemans@gmail.com" })).resolves.toBe(false);
    await expect(canSendTicketEmail(null)).resolves.toBe(false);
  });

  test("SEND_TICKET_EMAIL survives as a key and a checkbox, but is no longer a default", () => {
    // Kept so the column already stored on every Staff row stays meaningful,
    // and so the decision costs one line to reverse. It grants nothing now.
    expect(authz).toContain("SEND_TICKET_EMAIL: \"SEND_TICKET_EMAIL\"");
    expect(authz).toContain("key: STAFF_PERMISSIONS.SEND_TICKET_EMAIL");
    expect(authz).not.toContain("STAFF_PERMISSIONS.SEND_TICKET_EMAIL,\n]);");
  });

  test("a stored grant cannot re-open it — it is not even a default any more", async () => {
    const { DEFAULT_STAFF_PERMISSIONS, STAFF_PERMISSIONS } = await import("@/lib/authorization");
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain(STAFF_PERMISSIONS.SEND_TICKET_EMAIL);
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

describe("Operations keeps the send action, gated the same way", () => {
  const actions = source("actions/dashboard/admin-operations.js");
  const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");

  test("the transaction detail data computes the check server-side", () => {
    expect(actions).toMatch(/import \{[^}]*\bcanSendTicketEmail\b[^}]*\} from "@\/lib\/authorization"/);
    expect(actions).toContain("canSendTicketEmail,");
  });

  test("the drawer only renders the action under that flag", () => {
    expect(drawer).toContain("detail.canSendTicketEmail");
    expect(drawer).toContain("sendTicketByEmail(paymentId)");
  });
});
