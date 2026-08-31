import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 31 Aug 2026: staff had to leave the order they were looking at and hunt for
// the matching row in Opérations just to issue a credit note — this puts the
// same action (and the download link once it exists) directly on the order
// detail page.
describe("an invoiced order's Documents block offers to generate its credit note", () => {
  const ordersSource = source("actions/boutique/orders.js");
  const clientSource = source("components/dashboard/boutique/OrderDetailClient.jsx");
  const pageSource = source("app/dashboard/boutique/orders/[id]/page.jsx");

  test("the server exposes which transaction a credit note would be generated for — an order's payment is always a single FINAL_PAYMENT", () => {
    expect(ordersSource).toContain(
      'order.payment.transactions?.find((t) => t.transactionType === "FINAL_PAYMENT" && !t.creditNoteId)?.id ?? null'
    );
    // Only meaningful once an invoice actually exists — no invoice, nothing
    // to credit, regardless of what transactions exist on the payment.
    const idx = ordersSource.indexOf("creditableTransactionId:");
    expect(idx).toBeGreaterThan(-1);
    expect(ordersSource.slice(idx - 60, idx + 60)).toContain("order.payment?.invoice");
  });

  test("an existing credit note is offered as a download, worded as such", () => {
    expect(clientSource).toContain("Télécharger la note de crédit {cn.number}");
    expect(clientSource).toContain("/api/credit-notes/${cn.id}/pdf");
  });

  test("a missing credit note on an invoiced order offers to generate one", () => {
    expect(clientSource).toContain("issueCreditNoteForTransaction");
    expect(clientSource).toContain("Générer la note de crédit");
    expect(clientSource).toContain("order.creditableTransactionId");
  });

  test("the generate button only renders for admins — issueCreditNoteForTransaction is admin-only server-side, and this page also serves ORDERS-only staff", () => {
    expect(clientSource).toContain("isAdmin && order.creditableTransactionId");
    expect(pageSource).toContain("isAdminRole(user.role)");
  });

  test("generating asks for confirmation, same wording as Opérations, since the document is legally permanent once issued", () => {
    expect(clientSource).toContain("Générer une note de crédit ?");
    expect(clientSource).toContain(
      "Ce document porte un numéro légal, séquentiel et définitif — une fois émis, il ne peut plus être annulé ni modifié."
    );
  });

  test("a successful generation refreshes the page so the new download link appears without a manual reload", () => {
    const fnIdx = clientSource.indexOf("async function handleGenerateCreditNote");
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBody = clientSource.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toContain("router.refresh()");
  });
});
