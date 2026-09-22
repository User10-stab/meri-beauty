import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { testTag } from "./helpers.js";

// Proves the actual DB-level claim in actions/boutique/mondial-relay.js
// closes the double-purchase race — not just that the code contains the
// right `updateMany` shape (see mondial-relay-label-action-contracts.test.js
// for that), but that two real concurrent requests against a real Postgres
// row really do resolve to exactly one winner.
vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "staff-test", role: "ADMIN", email: "admin@example.test" } }),
}));

const MONDIAL_RELAY_ENV = {
  MONDIAL_RELAY_API_LOGIN: "test-login",
  MONDIAL_RELAY_API_PASSWORD: "test-password",
  MONDIAL_RELAY_CUSTOMER_ID: "test-customer",
  MONDIAL_RELAY_SENDER_NAME: "Meri Beauty",
  MONDIAL_RELAY_SENDER_STREET: "Rue Test",
  MONDIAL_RELAY_SENDER_HOUSE_NO: "1",
  MONDIAL_RELAY_SENDER_POSTAL_CODE: "1090",
  MONDIAL_RELAY_SENDER_CITY: "Jette",
  MONDIAL_RELAY_SENDER_PHONE: "+32470000000",
};
for (const [key, value] of Object.entries(MONDIAL_RELAY_ENV)) process.env[key] = value;

// The carrier call itself is faked — this test is about our own row-locking,
// not Mondial Relay's real behaviour (see the sandbox characterization step
// of the test plan for that). An artificial delay widens the race window so
// a real bug (both requests slipping past the claim) can't pass by luck.
let callCount = 0;
const createShipmentLabel = vi.fn().mockImplementation(async () => {
  callCount += 1;
  const mine = callCount;
  await new Promise((resolve) => setTimeout(resolve, 40));
  return { success: true, shipmentNumber: `MR-RACE-${mine}`, labelUrl: `https://example.test/label-${mine}.pdf`, rawResponse: "<ok/>" };
});
vi.mock("@/lib/mondial-relay", () => ({ createShipmentLabel }));
vi.mock("@/lib/mondial-relay-label-storage", () => ({ storeShippingLabel: vi.fn().mockResolvedValue(true) }));

const { prisma } = await import("@/lib/prisma");
const { generateShippingLabel } = await import("@/actions/boutique/mondial-relay");

const tag = testTag();

describe("real concurrency: two simultaneous label requests on the same order", () => {
  let order;

  beforeAll(async () => {
    order = await prisma.order.create({
      data: {
        fulfilmentMode: "SHIPPING_PREPAID",
        status: "PROCESSING",
        subtotal: 20,
        totalAmount: 23.12,
        pickupPointId: `${tag}-relay`,
        pickupPointName: "Point Test",
        pickupPointAddress: "Rue Test 1",
        pickupPointPostalCode: "1000",
        pickupPointCity: "Bruxelles",
      },
    });
  });

  afterEach(() => {
    callCount = 0;
    createShipmentLabel.mockClear();
  });

  afterAll(async () => {
    await prisma.order.delete({ where: { id: order.id } });
  });

  test("exactly one of two concurrent generateShippingLabel calls buys a label", async () => {
    const [result1, result2] = await Promise.all([
      generateShippingLabel(order.id),
      generateShippingLabel(order.id),
    ]);

    const results = [result1, result2];
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // The real proof: Mondial Relay was only ever actually called once —
    // the claim stopped the second request before it reached the carrier,
    // it didn't just lose a write race afterwards.
    expect(createShipmentLabel).toHaveBeenCalledTimes(1);

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.trackingCode).toBe(successes[0].data.trackingCode);
    expect(finalOrder.labelRequestedAt).not.toBeNull();
  });

  test("a third call afterwards is refused with the already-generated message, still without calling Mondial Relay again", async () => {
    const result = await generateShippingLabel(order.id);
    expect(result.success).toBe(false);
    expect(createShipmentLabel).not.toHaveBeenCalled();
  });
});
