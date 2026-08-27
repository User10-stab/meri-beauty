import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pickupQrDataUrl } from "@/lib/qrcode";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("customer order history pickup QR", () => {
  test("creates a reusable PNG data URL from the stored pickup code", async () => {
    const qr = await pickupQrDataUrl("AB12CD34");
    expect(qr).toMatch(/^data:image\/png;base64,/);
  });

  test("regenerates the QR from the persistent pickup code for active store collections", () => {
    const action = source("actions/customer/order-history.js");

    // Match the symbol, not the exact import line: lib/qrcode also exports
    // checkInQrDataUrl for activity tickets now, and pinning the line shape
    // would fail on a change that leaves this guarantee untouched.
    expect(action).toMatch(/import\s*\{[^}]*pickupQrDataUrl[^}]*\}\s*from\s*"@\/lib\/qrcode"/);
    expect(action).toContain("await pickupQrDataUrl(order.pickupCode)");
    expect(action).toContain('order.fulfilmentMode !== "SHIPPING_PREPAID"');
    expect(action).toContain('["COMPLETED", "CANCELLED", "EXPIRED"]');
    expect(action).toContain("orders.map(attachPickupQr)");
  });

  test("renders both the reusable QR and its readable fallback code in the profile", () => {
    const profile = source("components/website/MonComptePageClient.jsx");

    expect(profile).toContain("order.pickupQr && order.pickupCode");
    expect(profile).toContain("Votre QR code de retrait");
    expect(profile).toContain("src={order.pickupQr}");
    expect(profile).toContain("{order.pickupCode}");
  });
});
