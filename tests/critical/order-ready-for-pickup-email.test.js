import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOrderReadyForPickupEmail } from "@/lib/orders/ready-for-pickup-email";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const baseOrder = {
  orderNumber: 112,
  pickupCode: "AB12CD",
  totalAmount: "34.5",
  expiresAt: new Date("2026-10-20T10:00:00Z"),
  items: [
    { productName: "Sérum éclat", variantName: "30 ml", quantity: 2 },
    { productName: "Baume <lèvres>", variantName: null, quantity: 1 },
  ],
};

describe("order ready-for-pickup e-mail", () => {
  test("prepaid order: code, items and address, no amount due and no deadline", () => {
    const email = buildOrderReadyForPickupEmail({
      order: { ...baseOrder, fulfilmentMode: "PICKUP_PREPAID" },
      customerName: "Julie Dupont",
      salonAddress: "Rue de la Paix 12, 1000 Bruxelles",
      hasQrAttachment: true,
    });

    expect(email.subject).toBe("Votre commande n°112 est prête – Meri Beauty");
    expect(email.text).toContain("Bonjour Julie Dupont,");
    expect(email.text).toContain("Code de retrait : AB12CD");
    expect(email.text).toContain("2 × Sérum éclat – 30 ml");
    expect(email.text).toContain("Adresse : Rue de la Paix 12, 1000 Bruxelles");
    expect(email.text).not.toContain("régler sur place");
    expect(email.text).not.toContain("annulée");
    expect(email.html).toContain("QR code de retrait est joint");
  });

  test("pay-on-site order: amount due at the counter and the collection deadline", () => {
    const email = buildOrderReadyForPickupEmail({
      order: { ...baseOrder, fulfilmentMode: "PICKUP_ON_SITE" },
      customerName: "Julie",
    });

    expect(email.text).toContain("Montant à régler sur place : 34,50 €");
    expect(email.text).toContain("au plus tard le mardi 20 octobre");
    expect(email.html).not.toContain("QR code de retrait est joint");
  });

  test("escapes free text in the HTML body", () => {
    const email = buildOrderReadyForPickupEmail({
      order: { ...baseOrder, fulfilmentMode: "PICKUP_PREPAID" },
      customerName: "<script>x</script>",
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Baume &lt;lèvres&gt;");
  });

  test("markOrderReadyForPickup e-mails the customer only after winning the status claim", () => {
    const orders = source("actions/boutique/orders.js");
    const start = orders.indexOf("export async function markOrderReadyForPickup");
    const body = orders.slice(start, orders.indexOf("\n}\n", start));

    expect(body.indexOf("claim.count === 0")).toBeGreaterThan(-1);
    expect(body.indexOf("sendOrderReadyForPickupEmail(orderId)")).toBeGreaterThan(body.indexOf("claim.count === 0"));
    expect(orders).toContain("buildOrderReadyForPickupEmail(");
  });
});
