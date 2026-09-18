import { beforeEach, describe, expect, test, vi } from "vitest";

// Two payable Stripe links for one client = two charges. She gets one link in
// the "Relancer le paiement" email; booking the same session again on the site
// used to mint a second. Nothing stopped it before 17/09/2026 only because an
// unpaid booking made the session look full — the paid-only-places rule that
// shipped that day removed that accidental guard, so the check has to be real.
const mocks = vi.hoisted(() => ({
  formationFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  reservationFindFirst: vi.fn(),
  reservationFindUnique: vi.fn(),
  reservationCreate: vi.fn(),
  queryRaw: vi.fn().mockResolvedValue([{ id: "session-1" }]),
  aggregate: vi.fn().mockResolvedValue({ _sum: { seatsCount: 0 } }),
  checkoutCreate: vi.fn().mockResolvedValue({ id: "cs_test", url: "https://stripe.test/pay" }),
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
    formation: { findUnique: mocks.formationFindUnique },
    user: { findFirst: mocks.userFindFirst, update: mocks.userUpdate, create: vi.fn(), findMany: mocks.userFindMany },
    formationSession: { findUnique: mocks.sessionFindUnique },
    staff: { findUnique: mocks.staffFindUnique },
    formationReservation: {
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
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { create: mocks.checkoutCreate } } },
}));
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
  buildFormationReservationCreatedNotification: vi.fn().mockReturnValue({}),
  createNotificationsBulk: vi.fn().mockResolvedValue({}),
  getActivityNotificationRecipients: vi.fn().mockResolvedValue([]),
}));

const { createFormationReservation } = await import("@/actions/formations/create-formation-reservation");

// vitest doesn't load .env, and the happy path mints a resume-checkout token.
process.env.AUTH_SECRET ??= "test-secret-at-least-32-chars-long-for-hmac";
process.env.NEXT_PUBLIC_APP_URL ??= "https://test.meribeauty.com";

const SESSION_ID = "session-1";
const FORMATION_ID = "formation-1";

const booking = {
  sessionId: SESSION_ID,
  formationId: FORMATION_ID,
  termsAccepted: true,
  paymentMethod: "DEPOSIT",
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
  totalPrice: 2200,
  depositAmount: 660,
  balanceDue: 1540,
  holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.formationFindUnique.mockResolvedValue({
    id: FORMATION_ID,
    type: "PRIVATE",
    title: "ACOMPTE BASE PRO - Victoria",
    status: "PUBLISHED",
    price: 2200,
    capacity: 1,
    depositPercentage: 30,
    sessions: [{ id: SESSION_ID, status: "SCHEDULED", capacity: 1, animatorId: null, startDate: new Date("2026-09-22T08:00:00Z") }],
  });
  mocks.aggregate.mockResolvedValue({ _sum: { seatsCount: 0 } });
  mocks.sessionFindUnique.mockResolvedValue(null);
  mocks.userFindMany.mockResolvedValue([]);
  mocks.staffFindUnique.mockResolvedValue(null);
  mocks.queryRaw.mockResolvedValue([{ id: SESSION_ID }]);
  mocks.reservationCreate.mockResolvedValue({ ...liveHold, id: "reservation-new" });
  // What createFormationReservationCheckoutSession re-reads before it builds
  // the Stripe session.
  mocks.reservationFindUnique.mockResolvedValue({
    ...liveHold,
    id: "reservation-new",
    session: {
      id: SESSION_ID,
      startDate: new Date("2026-09-22T08:00:00Z"),
      formation: { id: FORMATION_ID, title: "ACOMPTE BASE PRO - Victoria", type: "PRIVATE" },
    },
    customer: { id: "user-1", email: "v.guillaume0605@gmail.com" },
  });
  mocks.checkoutCreate.mockResolvedValue({ id: "cs_test", url: "https://stripe.test/pay" });
});

describe("a client who already has a payment link cannot be given a second one", () => {
  test("refuses the second booking instead of minting another Stripe session", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    const result = await createFormationReservation(booking);

    expect(result.success).toBe(false);
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    // The important half: no second payable link exists anywhere.
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
  });

  test("tells her to use the link already in her inbox, and why", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    const { message } = await createFormationReservation(booking);

    expect(message).toContain("déjà une réservation en attente de paiement");
    expect(message).toContain("email");
    expect(message).toContain("deux fois");
  });

  test("looks for the hold on this client and this session only, and only while it is live", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    await createFormationReservation(booking);

    const [{ where }] = mocks.reservationFindFirst.mock.calls[0];
    expect(where.sessionId).toBe(SESSION_ID);
    expect(where.customerId).toBe("user-1");
    expect(where.status).toBe("PENDING_DEPOSIT");
    // An expired hold must not block her forever — she has to be able to
    // rebook once her old link is dead.
    expect(where.holdExpiresAt).toHaveProperty("gt");
  });
});

describe("the refusal is narrow enough not to break normal booking", () => {
  test("a client with no live hold books as before", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: true }));
    mocks.reservationFindFirst.mockResolvedValue(null);

    const result = await createFormationReservation(booking);

    expect(result.success).toBe(true);
    expect(mocks.reservationCreate).toHaveBeenCalled();
    expect(mocks.checkoutCreate).toHaveBeenCalled();
  });

  test("an unverified guest still reuses her own hold rather than being refused", async () => {
    // She never reached Stripe — the hold was created without a checkout
    // session — so there is no second link to be charged by, and refusing her
    // would break resubmitting the form before confirming the email.
    mocks.userFindFirst.mockResolvedValue(customer({ emailVerified: false }));
    mocks.reservationFindFirst.mockResolvedValue(liveHold);

    const result = await createFormationReservation(booking);

    expect(result).toMatchObject({ success: true, requiresEmailVerification: true });
    expect(mocks.reservationCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutCreate).not.toHaveBeenCalled();
    expect(mocks.sendVerificationEmail).toHaveBeenCalled();
  });
});
