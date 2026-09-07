import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("customer receipt downloads", () => {
  test("loads payment collection metadata so account pages do not advertise receipts before money is recorded", () => {
    const history = source("actions/customer/order-history.js");
    expect(history).toContain("const paymentSelect");
    expect(history).toContain('transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] }');
    expect(history).toContain("payment: paymentSelect");
  });

  test("shows the owner a receipt link for both boutique orders and activity payments", () => {
    const profile = source("components/website/MonComptePageClient.jsx");
    const reservations = source("components/customer/MyReservationsClient.jsx");
    expect(profile).toContain("href={`/api/orders/${order.id}/ticket`}");
    expect(profile).toContain("href={`/api/payments/${payment.id}/ticket`}");
    expect(reservations).toContain("href={`/api/payments/${payment.id}/ticket`}");
  });

  test("keeps a B2B invoice and a pickup code visible alongside the receipt", () => {
    const profile = source("components/website/MonComptePageClient.jsx");
    const orderCard = profile.slice(profile.indexOf("function OrderCard"), profile.indexOf("function ReservationCard"));
    expect(orderCard).toContain("Code de retrait");
    expect(orderCard).toContain("<InvoiceLink invoice={order.payment?.invoice} />");
    expect(orderCard).toContain("<OrderTicketLink order={order} />");
  });
});
