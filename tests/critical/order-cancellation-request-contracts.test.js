import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("paid order cancellation requests", () => {
  const schema = source("prisma/schema.prisma");
  const orders = source("actions/boutique/orders.js");
  const account = source("components/website/MonComptePageClient.jsx");

  test("uses one durable review request per order", () => {
    expect(schema).toContain("model OrderCancellationRequest");
    expect(schema).toContain("orderId String @unique");
    expect(schema).toContain("enum OrderCancellationRequestStatus");
  });

  test("customer submission does not cancel, restock, issue documents, or call Stripe", () => {
    const submit = orders.slice(
      orders.indexOf("export async function submitOrderCancellationRequest"),
      orders.indexOf("export async function reviewOrderCancellationRequest")
    );
    expect(submit).toContain('session.user.role !== "CUSTOMER"');
    expect(submit).toContain("orderCancellationRequest.create");
    expect(submit).not.toContain("performOrderCancellation(");
    expect(submit).not.toContain("stripe.refunds.create");
  });

  test("only an admin approval cancels and queues the manual refund", () => {
    const review = orders.slice(orders.indexOf("export async function reviewOrderCancellationRequest"));
    expect(review).toContain("isAdminRole(guard.session.user.role)");
    expect(review).toContain('data: { status: "APPROVED"');
    expect(review).toContain("performOrderCancellation(");
    expect(review).toContain('where: { id: request.id, status: "APPROVED" }');
  });

  test("the account exposes no cancellation for an unfinished payment", () => {
    expect(account).toContain('const CUSTOMER_CANCELLABLE_STATUSES = ["PENDING_PICKUP"]');
    expect(account).toContain("Cette tentative de paiement sera automatiquement annulée");
    expect(account).toContain("Demander l&apos;annulation");
  });
});
