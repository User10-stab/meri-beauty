import { beforeEach, describe, expect, test, vi } from "vitest";

// The ateliers twin of tests/critical/formation-duplicate-booking-contracts.js.
// Both booking flows carried the same defect at the same spot: the "reuse the
// customer's own live hold" lookup was gated on `!user.emailVerified`, so a
// verified client holding a relance payment link could book the same session
// again and end up with two payable Stripe links for one place.
const mocks = vi.hoisted(() => ({
  activityFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  reservationFindFirst: vi.fn(),
  reservationFindUnique: vi.fn(),
  reservationCreate: vi.fn(),
  queryRaw: vi.fn(),
  aggregate: vi.fn(),
  checkoutCreate: vi.fn(),
  sendVerificationEmail: vi.fn().mockResolvedValue({}),
  // Payee resolution: the session's animator decides whose Stripe account
  // the seat is charged to. No animator => the salon, which is this suite's
  // case — these booking tests are about the duplicate-link guard, not
  // about routing.
  sessionFindUnique: vi.fn().mockResolvedValue(null),
  userFindMany: vi.fn().mockResolvedValue([]),
  staffFindUnique: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    activity: { findUnique: mocks.activityFindUnique },
    user: { findFirst: mocks.userFindFirst, update: mocks.userUpdate, create: vi.fn(), findMany: mocks.userFindMany },
    workshopSession: { findUnique: mocks.sessionFindUnique },
    staff: { findUnique: mocks.staffFindUnique },
    workshopReservation: {
      findFirst: mocks.reservationFindFirst,
      findUnique: mocks.reservationFindUnique,
      create: mocks.reservationCreate,
      aggregate: mocks.aggregate,
    },
    promoCode: { update: vi.fn(), updateMany: vi.fn() },
    $queryRaw: mocks.queryRaw,
  };
  client.$transaction = async (fn) => fn(client);
  return { prisma: client };
});

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { create: mocks.checkoutCreate } } } }));
vi.mock("@/actions/shared/send-checkout-verification-email", () => ({
  sendCheckoutVerificationEmail: mocks.sendVerificationEmail,
}));
vi.mock("@/lib/rate-limit", () => ({
  getClientIp: vi.fn().mockResolvedValue("127.0.0.1"),
  isRateLimited: vi.fn().mockReturnValue(false),
  recordRateLimitHit: vi.fn(),
}));
vi.mock("@/lib/terms-consent", async (importOriginal) => ({
  ...(await importOriginal()),
  recordTermsAcceptance: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/invoicing", () => ({ isSellerLegalDataComplete: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/notifications", () => ({
  buildWorkshopReservationCreatedNotification: vi.fn().mockReturnValue({}),
  createNotificationsBulk: vi.fn().mockResolvedValue({}),
  getActivityNotificationRecipients: vi.fn().mockResolvedValue([]),
}));

// vitest doesn't load .env, and the happy path mints a resume-checkout token.
process.env.AUTH_SECRET ??= "test-secret-at-least-32-chars-long-for-hmac";
process.env.NEXT_PUBLIC_APP_URL ??= "https://test.meribeauty.com";

const { createWorkshopReservation } = await import("@/actions/workshops/create-workshop-reservation");

const SESSION_ID = "session-1";
const ACTIVITY_ID = "activity-1";

const booking = {
  sessionId: SESSION_ID,
  activityId: ACTIVITY_ID,
  termsAccepted: true,
  paymentMethod: "DEPOSIT",
  seatsCount: 1,
  customerInfo: { fullName: "Victoria Guillaume", email: "v.guillaume0605@gmail.com", phone: "+32470112233" },
};

function customer({ emailVerified }) {
  return {
    id: "user-1",
    fullName: "Victoria Guillaume",
    email: "v.guillaume0605@gmail.com",
    phone: "+32470112233",
    role: "CUSTOMER",
    emailVerified,
    isCompany: false,
    vatNumber: null,
    addressLine1: "Rue Test 1",
  };
}

const liveHold = {
  id: "reservation-existing",
  sessionId: SESSION_ID,
  customerId: "user-1",
  status: "PENDING_DEPOSIT",
  seatsCount: 1,
  totalPrice: 120,
  depositAmount: 60,
  balanceDue: 60,
  holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activityFindUnique.mockResolvedValue({
    id: ACTIVITY_ID,
    type: "WORKSHOP",
    title: "Atelier Manucure Russe",
    status: "PUBLISHED",
    price: 120,
    capacity: 8,
    depositPercentage: 50,
    sessions: [{ id: SESSION_ID, status: "SCHEDULED", capacity: 8, animatorId: null, startDate: new Date("2026-10-02T09:00:00Z") }],
  });
  mocks.aggregate.mockResolvedValue({ _sum: { seatsCount: 0 } });
  mocks.sessionFindUnique.mockResolvedValue(null);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.staffFindUnique.mockResolvedValue(null);
  mocks.queryRaw.mockResolvedValue([{ id: SESSION_ID }]);
  mocks.reservationCreate.mockResolvedValue({ ...liveHold, id: "reservation-new" });
  mocks.reservationFindUnique.mockResolvedValue({
    ...liveHold,
    id: "reservation-new",
    session: {
      id: SESSION_ID,
      startDate: new Date("2026-10-02T09:00:00Z"),
      workshop: { id: ACTIVITY_ID, title: "Atelier Manucure Russe", type: "WORKSHOP" },
    },
    customer: { id: "user-1", email: "v.guillaume0605@gmail.com" },
  });
  mocks.checkoutCreate.mockResolvedValue({ id: "cs_test", url: "https://stripe.test/pay" });
});

describe("ateliers: a client who already has a payment link cannot be given a second one", () => {
  test("refuses the second booking instead of minting another Stripe session", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    const result = await createWorkshopReservation(booking);

    expect(result.success).toBe(false);
    expect(result.message).toContain("déjà une réservation en attente de paiement");
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  test("looks for the hold on this client and this session only, and only while it is live", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    await createWorkshopReservation(booking);

    const [{ where }] = mocks.reservationFindFirst.mock.calls[0];
    expect(where.sessionId).toBe(SESSION_ID);
    expect(where.customerId).toBe("user-1");
    expect(where.status).toBe("PENDING_DEPOSIT");
    expect(where.holdExpiresAt).toHaveProperty("gt");
  });
});

describe("ateliers: the refusal is narrow enough not to break normal booking", () => {
  test("a client with no live hold books as before", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(null);

    const result = await createWorkshopReservation(booking);

    expect(result.success).toBe(true);
    expect(mocks.reservationCreate).toHaveBeenCalled();
    expect(mocks.checkoutCreate).toHaveBeenCalled();
  });

  test("an unverified guest still reuses her own hold rather than being refused", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: false }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    const result = await createWorkshopReservation(booking);

    expect(result).toMatchObject({ success: true, requiresEmailVerification: true });
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
    expect(mocks.sendVerificationEmail).toHaveBeenCalled();
  });
});
