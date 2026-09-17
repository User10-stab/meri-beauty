import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    workshopReservation: { updateMany: vi.fn() },
    formationReservation: { updateMany: vi.fn() },
  };
  return {
    tx,
    auth: vi.fn(),
    authorize: vi.fn(),
    sendEmail: vi.fn(),
    writeAuditLog: vi.fn(),
    sessionOccupancy: vi.fn(),
    listedSessions: [],
    stripe: {
      checkout: {
        sessions: {
          list: vi.fn(),
          expire: vi.fn(),
          create: vi.fn(),
        },
      },
    },
    prisma: {
      workshopReservation: { findUnique: vi.fn() },
      formationReservation: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn) => fn(tx)),
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/stripe", () => ({ stripe: mocks.stripe }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/invoicing", () => ({ isSellerLegalDataComplete: vi.fn(async () => true) }));
vi.mock("@/lib/activity-reservation-access", () => ({ authorizeActivityReservationOperation: mocks.authorize }));
vi.mock("@/lib/audit-log", () => ({
  AUDIT_ACTIONS: { RESERVATION_PAYMENT_RELAUNCHED: "reservation.payment_relaunched" },
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/reservations/session-occupancy", () => ({
  OCCUPANCY_KINDS: { WORKSHOP: "WORKSHOP", FORMATION: "FORMATION" },
  sessionOccupancy: mocks.sessionOccupancy,
}));

import { resendActivityReservationPayment } from "@/actions/payments/resend-activity-payment";
import { canRelanceActivityPayment } from "@/lib/reservations/activity-payment-relance";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function workshopReservation(overrides = {}) {
  return {
    id: "wr_1",
    sessionId: "ws_1",
    status: "CANCELLED",
    cancelledByUserId: null,
    holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    seatsCount: 2,
    totalPrice: 100,
    depositAmount: 50,
    balanceDue: 50,
    payment: null,
    customer: { id: "u_1", email: "cliente@example.com", fullName: "Cliente" },
    session: {
      id: "ws_1",
      status: "SCHEDULED",
      startDate: FUTURE,
      capacity: 6,
      workshop: { id: "act_1", title: "Atelier maquillage", capacity: 6 },
    },
    ...overrides,
  };
}

function stripeHas(sessions) {
  mocks.stripe.checkout.sessions.list.mockImplementation(() => ({
    async *[Symbol.asyncIterator]() {
      yield* sessions;
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  mocks.authorize.mockResolvedValue({ success: true });
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.sessionOccupancy.mockResolvedValue(0);
  mocks.tx.workshopReservation.updateMany.mockResolvedValue({ count: 1 });
  mocks.stripe.checkout.sessions.create.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
  mocks.stripe.checkout.sessions.expire.mockResolvedValue({});
  stripeHas([]);
});

describe("canRelanceActivityPayment", () => {
  it("allows an unpaid hold and a hold expired by the sweep", () => {
    expect(canRelanceActivityPayment(workshopReservation({ status: "PENDING_DEPOSIT" }))).toBe(true);
    expect(canRelanceActivityPayment(workshopReservation())).toBe(true);
  });

  it("never undoes a cancellation someone decided, a paid booking, or a past session", () => {
    expect(canRelanceActivityPayment(workshopReservation({ cancelledByUserId: "admin" }))).toBe(false);
    expect(canRelanceActivityPayment(workshopReservation({ payment: { id: "p" } }))).toBe(false);
    expect(canRelanceActivityPayment(workshopReservation({ status: "CONFIRMED" }))).toBe(false);
    const past = workshopReservation();
    past.session = { ...past.session, startDate: new Date(Date.now() - 1000) };
    expect(canRelanceActivityPayment(past)).toBe(false);
  });

  it("has nothing to relance when a promo code made it free", () => {
    expect(canRelanceActivityPayment(workshopReservation({ totalPrice: 0, depositAmount: 0, balanceDue: 0 }))).toBe(false);
  });
});

describe("resendActivityReservationPayment", () => {
  it("re-holds the seat for the link's lifetime, closes older links, and e-mails the new one", async () => {
    mocks.prisma.workshopReservation.findUnique.mockResolvedValue(workshopReservation());
    stripeHas([
      { id: "cs_old", status: "open", metadata: { kind: "workshop", reservationId: "wr_1" } },
      { id: "cs_other", status: "open", metadata: { kind: "workshop", reservationId: "wr_other" } },
    ]);

    const result = await resendActivityReservationPayment({ kind: "WORKSHOP", id: "wr_1" });

    expect(result.success).toBe(true);
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledTimes(1);
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_old");

    const params = mocks.stripe.checkout.sessions.create.mock.calls[0][0];
    expect(params.metadata).toMatchObject({ kind: "workshop", workshopAction: "deposit", reservationId: "wr_1" });
    expect(params.line_items[0].price_data.unit_amount).toBe(5000);

    const update = mocks.tx.workshopReservation.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ id: "wr_1", status: "CANCELLED", cancelledByUserId: null });
    expect(update.data.status).toBe("PENDING_DEPOSIT");
    // The seat is held past the Stripe link's own expiry.
    expect(update.data.holdExpiresAt.getTime() / 1000).toBeGreaterThan(params.expires_at);

    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "cliente@example.com" }));
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain("https://checkout.stripe.test/cs_new");
  });

  it("refuses when Stripe already has a completed payment for the booking", async () => {
    mocks.prisma.workshopReservation.findUnique.mockResolvedValue(workshopReservation());
    stripeHas([{ id: "cs_paid", status: "complete", metadata: { kind: "workshop", reservationId: "wr_1" } }]);

    const result = await resendActivityReservationPayment({ kind: "WORKSHOP", id: "wr_1" });

    expect(result.success).toBe(false);
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("expires the new link and sends nothing when the session filled up meanwhile", async () => {
    mocks.prisma.workshopReservation.findUnique.mockResolvedValue(workshopReservation());
    mocks.sessionOccupancy.mockResolvedValue(5);

    const result = await resendActivityReservationPayment({ kind: "WORKSHOP", id: "wr_1" });

    expect(result).toEqual({ success: false, message: expect.stringContaining("complète") });
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_new");
    expect(mocks.tx.workshopReservation.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("respects the reservation access guard", async () => {
    mocks.authorize.mockResolvedValue({ success: false, message: "Cette réservation ne fait pas partie de vos séances." });

    const result = await resendActivityReservationPayment({ kind: "FORMATION", id: "fr_1" });

    expect(result.success).toBe(false);
    expect(mocks.prisma.formationReservation.findUnique).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
