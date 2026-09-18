import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SALON_PAYEE,
  listIndependentPayeeStaffIds,
  payeeCanChargeOnline,
  payeePaymentData,
  payeeStripeOptions,
  resolvePayeeForAppointment,
  resolvePayeeForFormationSession,
  resolvePayeeForWorkshopSession,
  staffIdForAnimatorEmail,
} from "@/lib/payments/resolve-payee";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// Production's shape: an ADMIN with no Staff row, Marie (STAFF role, type
// INDEPENDENT, but her VAT number IS the salon's), and Julie (independent).
const SALON_USERS = [
  { id: "u_admin", staff: null },
  { id: "u_marie", staff: { id: "s_marie" } },
];
const STAFF = {
  s_marie: { id: "s_marie", type: "INDEPENDENT", userId: "u_marie", isDeleted: false, stripeAccountId: "acct_marie", stripeChargesEnabled: true, stripePayoutsEnabled: true },
  s_julie: { id: "s_julie", type: "INDEPENDENT", userId: "u_julie", isDeleted: false, stripeAccountId: "acct_julie", stripeChargesEnabled: true, stripePayoutsEnabled: true },
  s_emma: { id: "s_emma", type: "EMPLOYEE", userId: "u_emma", isDeleted: false, stripeAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false },
};

function clientMock({ workshopSession = null, formationSession = null } = {}) {
  return {
    user: { findMany: vi.fn(() => Promise.resolve(SALON_USERS)) },
    staff: {
      findUnique: vi.fn(({ where }) => Promise.resolve(STAFF[where.id] ?? null)),
      findMany: vi.fn(() => Promise.resolve(Object.values(STAFF).filter((s) => s.type === "INDEPENDENT").map(({ id }) => ({ id })))),
      findFirst: vi.fn(() => Promise.resolve({ id: "s_julie" })),
    },
    workshopSession: { findUnique: vi.fn(() => Promise.resolve(workshopSession)) },
    formationSession: { findUnique: vi.fn(() => Promise.resolve(formationSession)) },
  };
}

describe("resolvePayee — whose money a payment is", () => {
  it("an independent's appointment is hers", async () => {
    const payee = await resolvePayeeForAppointment(clientMock(), { staffId: "s_julie" });
    expect(payee.payeeStaffId).toBe("s_julie");
    expect(payee.staff.stripeAccountId).toBe("acct_julie");
  });

  it("Marie's appointment is the salon's, although her type is INDEPENDENT", async () => {
    const payee = await resolvePayeeForAppointment(clientMock(), { staffId: "s_marie" });
    expect(payee).toEqual(SALON_PAYEE);
  });

  it("an employee's appointment is the salon's", async () => {
    expect(await resolvePayeeForAppointment(clientMock(), { staffId: "s_emma" })).toEqual(SALON_PAYEE);
  });

  it("an unknown or missing practitioner falls back to the salon", async () => {
    expect(await resolvePayeeForAppointment(clientMock(), { staffId: "s_ghost" })).toEqual(SALON_PAYEE);
    expect(await resolvePayeeForAppointment(clientMock(), { staffId: null })).toEqual(SALON_PAYEE);
  });

  it("a formation seat belongs to the session's animator when she is an independent", async () => {
    const client = clientMock({ formationSession: { animator: { staffId: "s_julie" }, formation: { animator: null } } });
    expect((await resolvePayeeForFormationSession(client, { sessionId: "fs1" })).payeeStaffId).toBe("s_julie");
  });

  it("with no session animator, the formation's own animator decides", async () => {
    const client = clientMock({ formationSession: { animator: null, formation: { animator: { staffId: "s_julie" } } } });
    expect((await resolvePayeeForFormationSession(client, { sessionId: "fs1" })).payeeStaffId).toBe("s_julie");
  });

  it("an outside animator (no staff profile) is the salon's event", async () => {
    const client = clientMock({ workshopSession: { animator: { staffId: null }, workshop: { animator: null } } });
    expect(await resolvePayeeForWorkshopSession(client, { sessionId: "ws1" })).toEqual(SALON_PAYEE);
  });

  it("an atelier Marie animates stays the salon's", async () => {
    const client = clientMock({ workshopSession: { animator: { staffId: "s_marie" }, workshop: { animator: null } } });
    expect(await resolvePayeeForWorkshopSession(client, { sessionId: "ws1" })).toEqual(SALON_PAYEE);
  });

  it("lists every independent payee, without Marie", async () => {
    expect(await listIndependentPayeeStaffIds(clientMock())).toEqual(["s_julie"]);
  });
});

describe("payee helpers", () => {
  const julie = { payeeStaffId: "s_julie", staff: STAFF.s_julie };

  test("the salon can always charge online; an independent only once Stripe is ready", () => {
    expect(payeeCanChargeOnline(SALON_PAYEE)).toBe(true);
    expect(payeeCanChargeOnline(julie)).toBe(true);
    expect(payeeCanChargeOnline({ payeeStaffId: "s_julie", staff: { ...STAFF.s_julie, stripePayoutsEnabled: false } })).toBe(false);
  });

  test("an independent is charged on her own connected account", () => {
    expect(payeeStripeOptions(julie)).toEqual({ stripeAccount: "acct_julie" });
    expect(payeeStripeOptions(SALON_PAYEE)).toBeUndefined();
  });

  test("the charged account is recorded separately from the owner", () => {
    expect(payeePaymentData(julie)).toEqual({ payeeStaffId: "s_julie", stripeAccountId: null });
    // Marie's appointment: salon money, charged on her own connected account.
    expect(payeePaymentData(SALON_PAYEE, { stripeAccountId: "acct_marie" })).toEqual({ payeeStaffId: null, stripeAccountId: "acct_marie" });
  });

  test("an animator e-mail resolves to the staff profile it belongs to", async () => {
    expect(await staffIdForAnimatorEmail(clientMock(), "julie@example.com")).toBe("s_julie");
    expect(await staffIdForAnimatorEmail(clientMock(), null)).toBeNull();
  });
});

// A Payment created without its owner silently becomes the salon's — its
// money lands in the salon's books and a salon document can follow. Every
// appointment / atelier / formation creation site must stamp it.
describe("every appointment, atelier and formation payment is created with its payee", () => {
  test.each([
    "actions/payment/createCheckoutSession.js",
    "actions/appointment/confirm-accepted-appointment.js",
    "actions/appointment/create-manual-appointment.js",
    "actions/appointment/manage-appointment.js",
    "lib/appointments/accepted-payment.js",
    "actions/reservation/create-reservation.js",
    "actions/counter/create-reservation.js",
    "lib/formations/fulfill-formation-reservation-payment.js",
    "lib/workshops/fulfill-workshop-reservation-payment.js",
  ])("%s", (path) => {
    const code = source(path);
    const creates = code.split("payment.create({").slice(1);
    expect(creates.length).toBeGreaterThan(0);
    for (const block of creates) {
      expect(block.slice(0, 400)).toContain("...payeePaymentData(");
    }
  });

  test("an animator picked for a formation, or saved in the directory, is linked to its staff profile", () => {
    expect(source("actions/formations/create-formation.js")).toContain("staffId: staff.id");
    expect(source("actions/workshops/create-animator.js").match(/staffIdForAnimatorEmail\(prisma, email\)/g)).toHaveLength(2);
  });
});
