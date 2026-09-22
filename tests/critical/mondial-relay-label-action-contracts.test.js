import { beforeEach, describe, expect, test, vi } from "vitest";

// Every guard here exists because a real, billed Mondial Relay label was
// either bought twice (no claim before the call) or its outcome silently
// lost (no timeout/uncertain handling, no persisted raw response, no local
// PDF copy). See the Mondial Relay test plan.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  isTillCashOperator: vi.fn(),
  isAdminRole: vi.fn(),
  isBoutiqueShippingEnabledFor: vi.fn().mockReturnValue(true),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderUpdate: vi.fn(),
  createShipmentLabel: vi.fn(),
  storeShippingLabel: vi.fn(),
  captureCriticalError: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authorization", () => ({
  isTillCashOperator: mocks.isTillCashOperator,
  isAdminRole: mocks.isAdminRole,
}));
vi.mock("@/lib/commerce-availability", () => ({
  isBoutiqueShippingEnabledFor: mocks.isBoutiqueShippingEnabledFor,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    order: {
      findUnique: mocks.orderFindUnique,
      updateMany: mocks.orderUpdateMany,
      update: mocks.orderUpdate,
    },
  },
}));
vi.mock("@/lib/mondial-relay", () => ({ createShipmentLabel: mocks.createShipmentLabel }));
vi.mock("@/lib/mondial-relay-label-storage", () => ({ storeShippingLabel: mocks.storeShippingLabel }));
vi.mock("@/lib/monitoring", () => ({ captureCriticalError: mocks.captureCriticalError }));

const { generateShippingLabel, clearStuckLabelClaim } = await import("@/actions/boutique/mondial-relay");

const ENV_KEYS = [
  "MONDIAL_RELAY_API_LOGIN",
  "MONDIAL_RELAY_API_PASSWORD",
  "MONDIAL_RELAY_CUSTOMER_ID",
  "MONDIAL_RELAY_SENDER_NAME",
  "MONDIAL_RELAY_SENDER_STREET",
  "MONDIAL_RELAY_SENDER_HOUSE_NO",
  "MONDIAL_RELAY_SENDER_POSTAL_CODE",
  "MONDIAL_RELAY_SENDER_CITY",
  "MONDIAL_RELAY_SENDER_PHONE",
];

function baseOrder(overrides = {}) {
  return {
    id: "order-1",
    orderNumber: 42,
    fulfilmentMode: "SHIPPING_PREPAID",
    status: "PROCESSING",
    trackingCode: null,
    labelRequestedAt: null,
    pickupPointId: "REL123",
    pickupPointAddress: "Rue X",
    pickupPointPostalCode: "1000",
    pickupPointCity: "Bruxelles",
    user: { fullName: "Client", phone: "+32470000000", email: "client@example.com" },
    items: [{ variantId: "v1", quantity: 2, variant: { weightGrams: 100 } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) process.env[key] = "set";
  mocks.auth.mockResolvedValue({ user: { id: "staff-1", role: "STAFF", email: "marie@meribeautystudio.com" } });
  mocks.isTillCashOperator.mockReturnValue(true);
  mocks.isAdminRole.mockReturnValue(false);
  mocks.isBoutiqueShippingEnabledFor.mockReturnValue(true);
  mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.orderUpdate.mockResolvedValue({});
  mocks.storeShippingLabel.mockResolvedValue(true);
});

describe("generateShippingLabel — guards, in order, before ever calling Mondial Relay", () => {
  test("refuses an unauthenticated / non-operator caller without touching the order", async () => {
    mocks.isTillCashOperator.mockReturnValue(false);
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.orderFindUnique).not.toHaveBeenCalled();
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });

  test("refuses when Mondial Relay config is incomplete, before reading the order", async () => {
    delete process.env.MONDIAL_RELAY_CUSTOMER_ID;
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.orderFindUnique).not.toHaveBeenCalled();
  });

  test("refuses a non-SHIPPING_PREPAID order", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder({ fulfilmentMode: "PICKUP_ON_SITE" }));
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });

  test("refuses outside the pilot allowlist", async () => {
    mocks.isBoutiqueShippingEnabledFor.mockReturnValue(false);
    mocks.orderFindUnique.mockResolvedValue(baseOrder());
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });

  test.each(["PENDING_PAYMENT", "CANCELLED", "EXPIRED", "SHIPPED", "COMPLETED"])(
    "refuses status %s — a label costs real postage",
    async (status) => {
      mocks.orderFindUnique.mockResolvedValue(baseOrder({ status }));
      const result = await generateShippingLabel("order-1");
      expect(result.success).toBe(false);
      expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
    }
  );

  test("refuses when a tracking code already exists (fast-path message)", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder({ trackingCode: "MR123" }));
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(result.message).toContain("MR123");
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });

  test("refuses when a claim is already outstanding — uncertain outcome not yet cleared", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder({ labelRequestedAt: new Date() }));
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });

  test("refuses without a pickup point id (manual fallback order)", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder({ pickupPointId: null }));
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });

  test("refuses if the atomic claim loses the race — never calls Mondial Relay twice for one order", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder());
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    const result = await generateShippingLabel("order-1");
    expect(result.success).toBe(false);
    expect(mocks.createShipmentLabel).not.toHaveBeenCalled();
  });
});

describe("generateShippingLabel — weight computation", () => {
  test("sums variant weight × quantity across items", async () => {
    mocks.orderFindUnique.mockResolvedValue(
      baseOrder({ items: [{ variantId: "v1", quantity: 2, variant: { weightGrams: 120 } }, { variantId: "v2", quantity: 1, variant: { weightGrams: 480 } }] })
    );
    mocks.createShipmentLabel.mockResolvedValue({ success: true, shipmentNumber: "MR1", labelUrl: "https://x/1.pdf", rawResponse: "<ok/>" });
    await generateShippingLabel("order-1");
    expect(mocks.createShipmentLabel).toHaveBeenCalledWith(expect.objectContaining({ weightGrams: 720 }));
  });

  test("falls back to 500g when total weight is zero", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder({ items: [{ variantId: "v1", quantity: 1, variant: { weightGrams: 0 } }] }));
    mocks.createShipmentLabel.mockResolvedValue({ success: true, shipmentNumber: "MR1", labelUrl: "https://x/1.pdf", rawResponse: "<ok/>" });
    await generateShippingLabel("order-1");
    expect(mocks.createShipmentLabel).toHaveBeenCalledWith(expect.objectContaining({ weightGrams: 500 }));
  });
});

describe("generateShippingLabel — outcomes after the claim", () => {
  test("success: claims first, stores the PDF locally, writes trackingCode/labelUrl/labelRawResponse", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder());
    mocks.createShipmentLabel.mockResolvedValue({ success: true, shipmentNumber: "MR1", labelUrl: "https://x/1.pdf", rawResponse: "<ok/>" });

    const result = await generateShippingLabel("order-1");

    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: { id: "order-1", trackingCode: null, labelRequestedAt: null },
      data: { labelRequestedAt: expect.any(Date) },
    });
    expect(mocks.storeShippingLabel).toHaveBeenCalledWith("order-1", "https://x/1.pdf");
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { trackingCode: "MR1", labelUrl: "https://x/1.pdf", labelRawResponse: "<ok/>" },
    });
    expect(result).toEqual({
      success: true,
      message: expect.any(String),
      data: { trackingCode: "MR1", labelUrl: "https://x/1.pdf" },
    });
  });

  test("success even when the local PDF copy fails — the label is bought regardless, but it's logged critically", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder());
    mocks.createShipmentLabel.mockResolvedValue({ success: true, shipmentNumber: "MR1", labelUrl: "https://x/1.pdf", rawResponse: "<ok/>" });
    mocks.storeShippingLabel.mockResolvedValue(false);

    const result = await generateShippingLabel("order-1");

    expect(result.success).toBe(true);
    expect(mocks.captureCriticalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ orderId: "order-1" }));
  });

  test("uncertain failure: does NOT clear the claim, logs critically, returns the uncertain message", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder());
    mocks.createShipmentLabel.mockResolvedValue({ success: false, uncertain: true, message: "Vérifiez le portail Mondial Relay avant de réessayer.", rawResponse: null });

    const result = await generateShippingLabel("order-1");

    expect(result).toEqual({ success: false, message: "Vérifiez le portail Mondial Relay avant de réessayer." });
    expect(mocks.orderUpdate).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { labelRawResponse: null } });
    // labelRequestedAt is deliberately absent from this write — clearing it
    // here is exactly what could let a retry buy a second real shipment.
    expect(mocks.orderUpdate.mock.calls[0][0].data).not.toHaveProperty("labelRequestedAt");
    expect(mocks.captureCriticalError).toHaveBeenCalled();
  });

  test("confirmed rejection: clears the claim so staff can fix the input and retry immediately", async () => {
    mocks.orderFindUnique.mockResolvedValue(baseOrder());
    mocks.createShipmentLabel.mockResolvedValue({ success: false, message: "Point relais inconnu", rawResponse: "<err/>" });

    const result = await generateShippingLabel("order-1");

    expect(result).toEqual({ success: false, message: "Point relais inconnu" });
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: { labelRequestedAt: null, labelRawResponse: "<err/>" },
    });
    expect(mocks.captureCriticalError).not.toHaveBeenCalled();
  });
});

describe("clearStuckLabelClaim", () => {
  test("refuses a non-admin", async () => {
    mocks.isAdminRole.mockReturnValue(false);
    const result = await clearStuckLabelClaim("order-1");
    expect(result.success).toBe(false);
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });

  test("reports nothing to clear when there is no outstanding claim", async () => {
    mocks.isAdminRole.mockReturnValue(true);
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    const result = await clearStuckLabelClaim("order-1");
    expect(result.success).toBe(false);
  });

  test("clears the claim for an admin when one is outstanding", async () => {
    mocks.isAdminRole.mockReturnValue(true);
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    const result = await clearStuckLabelClaim("order-1");
    expect(result.success).toBe(true);
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: { id: "order-1", trackingCode: null, labelRequestedAt: { not: null } },
      data: { labelRequestedAt: null },
    });
  });
});
