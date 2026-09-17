import { beforeEach, describe, expect, test, vi } from "vitest";

// Two payment links for one place used to end here. The first payment
// confirms the booking; the second arrives on an already-CONFIRMED
// reservation and was answered with `alreadyProcessed: true` — the exact
// answer a redelivered webhook gets. So a second, real charge was swallowed
// in silence: no refund flag, no notification, nothing for anyone to act on.
// Discovered 17/09/2026 while closing the "ACOMPTE BASE PRO" double-booking.
const mocks = vi.hoisted(() => ({
  paymentFindFirst: vi.fn(),
  formationFindUnique: vi.fn(),
  workshopFindUnique: vi.fn(),
  flag: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findFirst: mocks.paymentFindFirst },
    formationReservation: { findUnique: mocks.formationFindUnique },
    workshopReservation: { findUnique: mocks.workshopFindUnique },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/payments/flag-payment-for-manual-refund", () => ({
  flagPaymentForManualRefund: mocks.flag,
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({}) }));
// Reached through the invoicing/audit-log import chain, and next-auth cannot
// load under vitest.
vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));

const { confirmFormationReservationPayment } = await import("@/lib/formations/fulfill-formation-reservation-payment");
const { confirmWorkshopReservationPayment } = await import("@/lib/workshops/fulfill-workshop-reservation-payment");

const CONFIRMING_SESSION = "cs_first_link";
const SECOND_SESSION = "cs_second_link";

const variants = [
  {
    label: "formations",
    confirm: (session) => confirmFormationReservationPayment(session),
    findUnique: () => mocks.formationFindUnique,
    kind: "formation",
    actionKey: "formationAction",
  },
  {
    label: "ateliers",
    confirm: (session) => confirmWorkshopReservationPayment(session),
    findUnique: () => mocks.workshopFindUnique,
    kind: "workshop",
    actionKey: "workshopAction",
  },
];

function checkoutSession(id, { kind, actionKey }) {
  return {
    id,
    metadata: { kind, [actionKey]: "deposit", reservationId: "reservation-1" },
    amount_total: 66000,
    payment_intent: "pi_second_charge",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(variants)("$label: a second payment on an already-paid booking", (variant) => {
  beforeEach(() => {
    variant.findUnique().mockResolvedValue({
      id: "reservation-1",
      status: "CONFIRMED",
      seatsCount: 1,
      totalPrice: 2200,
      depositAmount: 660,
      session: { id: "session-1", capacity: 1, formation: {}, workshop: {} },
      customer: { id: "user-1", email: "v.guillaume0605@gmail.com", billingProfile: null },
    });
  });

  test("is flagged for a manual refund instead of being swallowed", async () => {
    // No Payment row anywhere carries this session's id: neither the opening
    // idempotency lookup nor the re-check inside the CONFIRMED branch.
    mocks.paymentFindFirst.mockResolvedValue(null);

    const result = await confirmSecondPayment(variant);

    expect(mocks.flag).toHaveBeenCalledTimes(1);
    const [flagged, reason] = mocks.flag.mock.calls[0];
    expect(flagged.id).toBe(SECOND_SESSION);
    expect(reason).toContain("second paiement");
    expect(result).toMatchObject({ flaggedForReview: true, received: true, refunded: false });
    expect(result.alreadyProcessed).toBeUndefined();
  });

  test("a genuinely redelivered webhook is still a no-op, not a refund", async () => {
    // Same session id, already banked. Two deliveries of one event can both
    // pass the opening lookup and race, so the CONFIRMED branch re-checks —
    // and must recognise its own payment rather than flag it.
    mocks.paymentFindFirst.mockImplementation(async ({ where }) =>
      where.transactionReference === CONFIRMING_SESSION ? { id: "payment-1" } : null
    );

    const result = await variant.confirm(checkoutSession(CONFIRMING_SESSION, variant));

    expect(mocks.flag).not.toHaveBeenCalled();
    expect(result).toMatchObject({ received: true, alreadyProcessed: true });
  });

  test("the re-check looks the payment up by this session's own reference", async () => {
    mocks.paymentFindFirst.mockResolvedValue(null);

    await confirmSecondPayment(variant);

    // Both the opening idempotency lookup and the CONFIRMED re-check key off
    // the incoming session id — never off the reservation, which would find
    // the *first* payment and go on swallowing the second.
    for (const [{ where }] of mocks.paymentFindFirst.mock.calls) {
      expect(where).toEqual({ transactionReference: SECOND_SESSION });
    }
    expect(mocks.paymentFindFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

/** The second link clearing while the first one already banked its payment. */
function confirmSecondPayment(variant) {
  return variant.confirm(checkoutSession(SECOND_SESSION, variant));
}
