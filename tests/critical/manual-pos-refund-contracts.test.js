import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getOrderPaymentMethod,
  isManualOrderRefund,
  validateManualRefundConfirmation,
} from "@/lib/payments/refund-method";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("POS refund method resolution", () => {
  test("Stripe QR remains automatic while cash and external terminal card require cashier confirmation", () => {
    const online = { transactionReference: "cs_test_123", transactions: [{ method: "ONLINE", transactionType: "FINAL_PAYMENT" }] };
    const cash = { transactionReference: null, transactions: [{ method: "CASH", transactionType: "FINAL_PAYMENT" }] };
    const card = { transactionReference: null, transactions: [{ method: "CARD", transactionType: "FINAL_PAYMENT" }] };

    expect(getOrderPaymentMethod(online)).toBe("ONLINE");
    expect(isManualOrderRefund(online)).toBe(false);
    expect(getOrderPaymentMethod(cash)).toBe("CASH");
    expect(isManualOrderRefund(cash)).toBe(true);
    expect(getOrderPaymentMethod(card)).toBe("CARD");
    expect(isManualOrderRefund(card)).toBe(true);
  });

  test("manual cash needs confirmation and terminal card also needs its receipt reference", () => {
    expect(validateManualRefundConfirmation({ method: "CASH", confirmed: false })).toMatch(/Confirmez/);
    expect(validateManualRefundConfirmation({ method: "CASH", confirmed: true })).toBeNull();
    expect(validateManualRefundConfirmation({ method: "CARD", confirmed: true, reference: "" })).toMatch(/référence/i);
    expect(validateManualRefundConfirmation({ method: "CARD", confirmed: true, reference: "TERMINAL-42" })).toBeNull();
    expect(validateManualRefundConfirmation({ method: "ONLINE", confirmed: false })).toBeNull();
  });
});

describe("POS return and cancellation safeguards", () => {
  const returns = source("actions/boutique/returns.js");
  const orders = source("actions/boutique/orders.js");
  const returnsUi = source("components/dashboard/boutique/ReturnsPageClient.jsx");
  const orderUi = source("components/dashboard/boutique/OrderDetailClient.jsx");

  test("return completion enforces a server-side manual confirmation and preserves the actual method", () => {
    expect(returns).toContain("validateManualRefundConfirmation");
    expect(returns).toContain("manualReference: originalMethod === \"CARD\"");
    expect(returns).toContain("method: originalMethod");
  });

  test("cancelling a paid physical POS order queues the refund for Operations", () => {
    expect(orders).toContain("queueManualRefund(tx");
    expect(orders).not.toContain("requiresManualRefundConfirmation: true");
    expect(orders).not.toContain("stripe.refunds.create");
  });

  test("only the dedicated returns screen asks the cashier for proof before completing physical refunds", () => {
    expect(returnsUi).toContain("manualRefundConfirmed");
    expect(returnsUi).toContain("Référence du ticket terminal (obligatoire)");
    expect(orderUi).not.toContain("manualRefundConfirmed");
    expect(orderUi).toContain("Aucun argent ne sera envoyé automatiquement");
  });
});
