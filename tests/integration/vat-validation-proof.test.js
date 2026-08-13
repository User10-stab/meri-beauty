import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { testTag } from "./helpers.js";

/**
 * Real-database proof for the two VAT fixes that tests/critical only asserts
 * on source text.
 *
 * User.vatNumber is paired with vatValidatedAt / vatValidationName /
 * vatValidationAddress, and lib/tax-policy.js#hasRecentVatValidation reads the
 * timestamp to decide whether a B2B sale qualifies for reverse-charge. Writing
 * the number without its proof — in either direction — produces a wrong VAT
 * treatment on a real invoice. These tests exercise the real actions against
 * the real database and then read the row back.
 *
 * Only Next request plumbing, Stripe, Resend and the live VIES network call
 * are faked. isValidVatFormat stays real (importOriginal below), because the
 * format gate is half of what's under test.
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.10" }),
}));

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "cs_test_fake", url: "https://stripe.test/fake" }),
        retrieve: vi.fn().mockResolvedValue({ payment_status: "unpaid" }),
      },
    },
    refunds: { create: vi.fn() },
  },
}));

// Partial mock: the live VIES lookup is a third-party network call, but the
// offline format/checksum check is real code under test.
vi.mock("@/lib/vat-validation", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, verifyVatWithVies: vi.fn() };
});

const { prisma } = await import("@/lib/prisma");
const { auth } = await import("@/auth");
const { verifyVatWithVies } = await import("@/lib/vat-validation");
const { POST: submitRentalRequest } = await import("@/app/api/rental-requests/route");
const { createWorkshopReservation } = await import("@/actions/workshops/create-workshop-reservation");

const tag = testTag();

let phoneCounter = 0;
function uniquePhone() {
  phoneCounter += 1;
  return `+32${Date.now()}${phoneCounter}`;
}

// The salon's own number and a valid French one — two genuinely different,
// genuinely well-formed numbers, so a rejection can only come from the change
// itself and never from a format failure.
const VERIFIED_VAT = "BE0751854027";
const OTHER_VALID_VAT = "FR40303265045";

function verifiedVatFields() {
  return {
    vatNumber: VERIFIED_VAT,
    vatValidatedAt: new Date(),
    vatValidationName: "MERI BEAUTY",
    vatValidationAddress: "Rue Bonaventure 113, 1090 Jette",
  };
}

function rentalRequestBody(vatNumber) {
  return {
    rentalType: "Cabine privative",
    startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    commissionType: "FIXED",
    specialty: "Coiffure",
    ...(vatNumber === undefined ? {} : { vatNumber }),
  };
}

function postRentalRequest(vatNumber) {
  return submitRentalRequest(
    new Request("http://localhost/api/rental-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rentalRequestBody(vatNumber)),
    })
  );
}

describe("rental request: the VAT verification proof never outlives the number", () => {
  let pro;

  beforeAll(async () => {
    pro = await prisma.user.create({
      data: {
        fullName: `${tag}-pro`,
        email: `${tag}-pro@example.test`,
        phone: uniquePhone(),
        password: "x",
        role: "CUSTOMER",
        emailVerified: true,
        ...verifiedVatFields(),
      },
    });
  });

  afterAll(async () => {
    if (pro) {
      await prisma.rentalRequest.deleteMany({ where: { userId: pro.id } });
      await prisma.notification.deleteMany({ where: { userId: pro.id } });
      await prisma.user.delete({ where: { id: pro.id } });
    }
  });

  beforeEach(async () => {
    // Reset to "registered with a VIES-verified number" before each case, and
    // clear any request an earlier case created so "nothing was written" can
    // be asserted as an absolute count rather than a delta.
    await prisma.rentalRequest.deleteMany({ where: { userId: pro.id } });
    await prisma.user.update({ where: { id: pro.id }, data: verifiedVatFields() });
    auth.mockResolvedValue({ user: { id: pro.id, role: "CUSTOMER" } });
  });

  test("submitting a DIFFERENT number clears the proof", async () => {
    const response = await postRentalRequest(OTHER_VALID_VAT);
    expect(response.status).toBe(201);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: pro.id } });
    expect(after.vatNumber).toBe(OTHER_VALID_VAT);
    // This is the whole point: without the fix the row kept the old
    // vatValidatedAt and tax policy read the new number as verified.
    expect(after.vatValidatedAt).toBeNull();
    expect(after.vatValidationName).toBeNull();
    expect(after.vatValidationAddress).toBeNull();
  });

  test("resubmitting the SAME number keeps the proof intact", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: pro.id } });

    const response = await postRentalRequest(VERIFIED_VAT);
    expect(response.status).toBe(201);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: pro.id } });
    expect(after.vatNumber).toBe(VERIFIED_VAT);
    expect(after.vatValidatedAt).toEqual(before.vatValidatedAt);
    expect(after.vatValidationName).toBe("MERI BEAUTY");
  });

  test("a malformed number is refused and touches nothing", async () => {
    const response = await postRentalRequest("abc");
    expect(response.status).toBe(400);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: pro.id } });
    expect(after.vatNumber).toBe(VERIFIED_VAT);
    expect(after.vatValidatedAt).not.toBeNull();

    const requests = await prisma.rentalRequest.findMany({ where: { userId: pro.id } });
    expect(requests).toHaveLength(0);
  });

  test("a missing number is refused — the asterisk on the form is now true", async () => {
    const response = await postRentalRequest(undefined);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(JSON.stringify(body)).toContain("obligatoire");

    const requests = await prisma.rentalRequest.findMany({ where: { userId: pro.id } });
    expect(requests).toHaveLength(0);
  });

  test("a Belgian number failing the checksum is refused", async () => {
    // Same shape and prefix as the real one, last digit changed.
    const response = await postRentalRequest("BE0751854028");
    expect(response.status).toBe(400);
  });
});

describe("workshop booking: a VIES-verified number is stored WITH its proof", () => {
  let activity, session, customer;

  beforeAll(async () => {
    // createWorkshopReservation refuses to start a payment while the salon's
    // own legal identity is incomplete (lib/invoicing.js#isSellerLegalDataComplete).
    // A freshly-migrated database has no salon row at all, so seed the minimum
    // that guard requires — this is the seller side, unrelated to what's under
    // test here.
    await prisma.salon.upsert({
      where: { id: "main-salon" },
      update: {},
      create: {
        id: "main-salon",
        name: "Meri Beauty",
        phone: "+3220000000",
        email: "salon@example.test",
        legalName: "Marie Mercier",
        vatNumber: "BE0751854027",
        addressLine1: "Rue Bonaventure 113",
        postalCode: "1090",
        city: "Jette",
        countryCode: "BE",
      },
    });

    activity = await prisma.activity.create({
      data: { type: "WORKSHOP", title: `${tag}-vat-workshop`, price: 50, duration: 60, capacity: 5, status: "PUBLISHED" },
    });
    session = await prisma.workshopSession.create({
      data: {
        workshopId: activity.id,
        startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        capacity: 5,
        status: "SCHEDULED",
      },
    });
    customer = await prisma.user.create({
      data: {
        // Letters only — validateCustomerIdentity rejects digits in a name,
        // and createWorkshopReservation revalidates the whole identity.
        fullName: "Claire Dubois",
        email: `${tag}-b2b@example.test`,
        phone: uniquePhone(),
        password: "x",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
  });

  afterAll(async () => {
    if (session) {
      await prisma.workshopReservation.deleteMany({ where: { sessionId: session.id } });
      await prisma.workshopSession.delete({ where: { id: session.id } });
    }
    if (activity) await prisma.activity.delete({ where: { id: activity.id } });
    if (customer) await prisma.user.delete({ where: { id: customer.id } });
  });

  test("the VIES result is written alongside the number, not discarded", async () => {
    verifyVatWithVies.mockResolvedValue({
      success: true,
      valid: true,
      name: "ATELIER TEST SPRL",
      address: "Rue de Test 1, 1000 Bruxelles",
    });
    auth.mockResolvedValue(null); // guest-style booking by email

    const result = await createWorkshopReservation({
      sessionId: session.id,
      activityId: activity.id,
      seatsCount: 1,
      customerInfo: {
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        vatNumber: VERIFIED_VAT,
      },
      paymentMethod: "DEPOSIT",
      termsAccepted: true,
    });

    expect(result.success).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.vatNumber).toBe(VERIFIED_VAT);
    // Before the fix these three stayed null even though VIES had just
    // confirmed the number, so the customer was taxed as unverified.
    expect(after.vatValidatedAt).not.toBeNull();
    expect(after.vatValidationName).toBe("ATELIER TEST SPRL");
    expect(after.vatValidationAddress).toBe("Rue de Test 1, 1000 Bruxelles");
  });
});
