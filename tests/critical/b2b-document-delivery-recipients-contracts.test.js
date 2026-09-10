import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 9 Sep 2026: the Operations delivery dialog gained a combined send —
// e-mail and Billit/Peppol together in one confirm — plus a global,
// admin-managed address book (NotificationRecipient) offered as extra
// recipients when e-mailing a B2B invoice / credit note. Nothing is
// pre-selected; the admin ticks channels and addresses.

describe("the managed recipient address book is admin-only and de-duped", () => {
  const actions = source("actions/invoices/notification-recipients.js");

  test("every mutation is server-side and admin-gated", () => {
    expect(actions).toContain('"use server"');
    expect(actions).toContain("isAdminRole(session.user.role)");
    for (const fn of [
      "listNotificationRecipients",
      "createNotificationRecipient",
      "updateNotificationRecipient",
      "deleteNotificationRecipient",
    ]) {
      expect(actions, `${fn} must be exported`).toContain(`export async function ${fn}`);
    }
    // One guard, reused — not four hand-rolled copies that could drift.
    expect(actions).toContain("await requireAdmin()");
  });

  test("a duplicate address is rejected with a message, not a 500", () => {
    expect(actions).toContain('error?.code === "P2002"');
    expect(actions).toContain("Cette adresse figure déjà dans la liste.");
  });

  test("the address is normalised before it hits the unique index", () => {
    const schema = source("lib/validations/notification-recipient.js");
    expect(schema).toContain(".trim()");
    expect(schema).toContain(".toLowerCase()");
    expect(schema).toContain(".email(");
  });

  test("the model carries a unique email and an isDefault sort flag", () => {
    const prisma = source("prisma/schema.prisma");
    const modelIdx = prisma.indexOf("model NotificationRecipient {");
    expect(modelIdx).toBeGreaterThan(-1);
    const model = prisma.slice(modelIdx, prisma.indexOf("\n}", modelIdx));
    expect(model).toContain("email     String   @unique");
    expect(model).toContain("isDefault Boolean  @default(false)");
  });

  test("the salon's own address is seeded once, not force-upserted", () => {
    const seed = source("prisma/seed.mjs");
    expect(seed).toContain("contact@meribeautystudio.com");
    expect(seed).toContain("prisma.notificationRecipient.findUnique");
    expect(seed).toContain("Default notification recipient created.");
  });
});

describe("the e-mail send takes extra recipients but never a substitute for the client", () => {
  for (const path of [
    "actions/invoices/send-invoice-email.js",
    "actions/invoices/send-credit-note-email.js",
  ]) {
    const send = source(path);

    test(`${path}: signature adds options only, keeping the id first`, () => {
      expect(send).toMatch(/By(?:Email|Mail)?\((?:invoiceId|creditNoteId), \{ extraRecipients = \[\], includeClient = true \} = \{\}\)/);
    });

    test(`${path}: the client address still comes from the document, never an argument`, () => {
      expect(send).toContain("invoice.customerEmail?.trim()");
      // includeClient only *omits* the client copy — there is no path that
      // swaps in a caller-supplied client address.
      expect(send).toContain("if (includeClient && clientEmail) recipientSet.add(clientEmail)");
      expect(send).toContain("recipientSet.add(email.trim().toLowerCase())");
    });

    test(`${path}: an empty recipient set is refused, not sent to nobody`, () => {
      expect(send).toContain("Aucun destinataire sélectionné");
    });

    test(`${path}: the audit log records the full recipient list`, () => {
      expect(send).toContain("recipients }");
      expect(send).toContain("to: recipients");
    });
  }
});

describe("the delivery dialog fires both channels behind one confirm", () => {
  const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");

  test("channels start unchecked and the send is gated on a real recipient", () => {
    expect(delivery).toContain("const [emailChecked, setEmailChecked] = useState(false)");
    expect(delivery).toContain("const [billitChecked, setBillitChecked] = useState(false)");
    expect(delivery).toContain("const canSend = !sending && (emailChecked || billitChecked) && (!emailChecked || emailHasRecipient)");
  });

  test("both sends run in one deliver() and report a combined outcome", () => {
    expect(delivery).toContain("if (emailChecked) {");
    expect(delivery).toContain("if (billitChecked) {");
    expect(delivery).toContain("const succeeded = []");
    expect(delivery).toContain("const failed = []");
    // On a partial failure the card stays open and the done channel un-ticks.
    expect(delivery).toContain("if (outcomes.email?.success) setEmailChecked(false)");
    expect(delivery).toContain("if (outcomes.billit?.success) setBillitChecked(false)");
  });

  test("the Billit gate still mirrors the server helper exactly", () => {
    expect(delivery).toContain('import { isBelgianVatNumber } from "@/lib/billit"');
    expect(delivery).toContain('invoice?.customerType === "B2B"');
    expect(delivery).toContain("isBelgianVatNumber(invoice?.customerVatNumber)");
  });
});
