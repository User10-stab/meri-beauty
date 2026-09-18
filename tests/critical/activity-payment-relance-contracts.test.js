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
      // Payee resolution — a relance has to rebuild the link on the SAME
      // Stripe account the first one was created on. No animator on the
      // session means the salon, which is what these cases exercise.
      workshopSession: { findUnique: vi.fn(async () => null) },
      formationSession: { findUnique: vi.fn(async () => null) },
      staff: { findUnique: vi.fn(async () => null) },
      user: { findMany: vi.fn(async () => []) },
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

function formationReservation(overrides = {}) {
  return {
    ...workshopReservation(),
    id: "fr_1",
    sessionId: "fs_1",
    session: {
      id: "fs_1",
      status: "SCHEDULED",
      startDate: FUTURE,
      capacity: 6,
      formation: { id: "f_1", title: "Formation base pro", capacity: 6, type: "PUBLIC" },
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
  mocks.tx.formationReservation.updateMany.mockResolvedValue({ count: 1 });
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
    // THIRD argument is the Stripe account the link lives on: undefined for a
    // salon sale, { stripeAccount } for an independent's. A link created on her
    // connected account is invisible to — and unclosable from — the platform.
    //
    // The position matters and this assertion is the reason it was wrong for a
    // while: expire(id, params, options), so options passed second is sent as a
    // request body field and the real API answers "Received unknown parameter:
    // stripeAccount". A mock accepts it happily, so these three assertions went
    // green while an independent's relance threw in production. Only the e2e
    // case against real Stripe caught it (18/09/2026).
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_old", {}, undefined);

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
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_new", {}, undefined);
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

  // A seat animated by an independent is a direct charge on HER account. Every
  // Stripe call a relance makes has to name that account: the platform cannot
  // see her sessions at all, so listing without it finds no earlier link,
  // closes nothing, and hands the client a SECOND payable link — the exact
  // double-charge this whole change set exists to prevent.
  // FORMATION, not WORKSHOP: an atelier is the salon's own event and its money
  // is the salon's whoever animates it (18/09/2026), so a formation seat is
  // the only activity seat that can belong to an independent at all. The
  // atelier half of that rule is pinned by its own describe below.
  describe("a formation seat animated by an independent stays on her Stripe account", () => {
    const JULIE_ACCOUNT = "acct_julie";

    beforeEach(() => {
      mocks.prisma.formationSession.findUnique.mockResolvedValue({
        animator: { staffId: "s_julie" },
        formation: { animator: { staffId: "s_julie" } },
      });
      mocks.prisma.staff.findUnique.mockResolvedValue({
        id: "s_julie",
        type: "INDEPENDENT",
        userId: "u_julie",
        isDeleted: false,
        stripeAccountId: JULIE_ACCOUNT,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      });
      mocks.prisma.formationReservation.findUnique.mockResolvedValue(formationReservation());
    });

    it("lists, closes and recreates the link on her account", async () => {
      stripeHas([{ id: "cs_old", status: "open", metadata: { kind: "formation", reservationId: "fr_1" } }]);

      const result = await resendActivityReservationPayment({ kind: "FORMATION", id: "fr_1" });

      expect(result.success).toBe(true);
      const options = { stripeAccount: JULIE_ACCOUNT };
      expect(mocks.stripe.checkout.sessions.list).toHaveBeenCalledWith(expect.anything(), options);
      expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_old", {}, options);
      expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.anything(), options);
    });

    it("freezes her as the payee and lets her account choose the payment methods", async () => {
      await resendActivityReservationPayment({ kind: "FORMATION", id: "fr_1" });

      const params = mocks.stripe.checkout.sessions.create.mock.calls[0][0];
      expect(params.metadata.payeeStaffId).toBe("s_julie");
      expect(params.payment_intent_data.metadata.payeeStaffId).toBe("s_julie");
      // Naming a method her account has not activated is a 400 that kills the
      // whole checkout — the iDEAL failure of 17/09/2026.
      expect(params).not.toHaveProperty("payment_method_types");
    });

    it("refuses rather than silently relaunching onto the salon when her account is not ready", async () => {
      mocks.prisma.staff.findUnique.mockResolvedValue({
        id: "s_julie",
        type: "INDEPENDENT",
        userId: "u_julie",
        isDeleted: false,
        stripeAccountId: JULIE_ACCOUNT,
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
      });

      const result = await resendActivityReservationPayment({ kind: "FORMATION", id: "fr_1" });

      expect(result.success).toBe(false);
      expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });
  });

  // The other half of the same rule, and the one that is easy to lose: an
  // atelier animated by a fully-onboarded independent must STILL be the
  // salon's. Nothing else here would notice if resolvePayeeForWorkshopSession
  // started reading the animator again — the relance would quietly move the
  // salon's own event revenue onto her Stripe account.
  describe("an atelier stays on the salon's account even when an independent animates it", () => {
    beforeEach(() => {
      mocks.prisma.workshopSession.findUnique.mockResolvedValue({
        animator: { staffId: "s_julie" },
        workshop: { animator: { staffId: "s_julie" } },
      });
      mocks.prisma.staff.findUnique.mockResolvedValue({
        id: "s_julie",
        type: "INDEPENDENT",
        userId: "u_julie",
        isDeleted: false,
        stripeAccountId: "acct_julie",
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      });
      mocks.prisma.workshopReservation.findUnique.mockResolvedValue(workshopReservation());
    });

    it("creates the new link on the platform, with no connected account and no payee", async () => {
      stripeHas([]);

      const result = await resendActivityReservationPayment({ kind: "WORKSHOP", id: "wr_1" });

      expect(result.success).toBe(true);
      // `undefined` options, not `{ stripeAccount: … }` — a platform charge.
      expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.anything(), undefined);

      const params = mocks.stripe.checkout.sessions.create.mock.calls[0][0];
      expect(params.metadata.payeeStaffId).toBe("");
      expect(params.payment_intent_data.metadata.payeeStaffId).toBe("");
      // The salon's own sales keep their explicit, verified method list.
      expect(params.payment_method_types).toEqual(["card", "bancontact"]);
    });
  });
});
