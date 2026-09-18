import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PAYEE_METADATA_KEY,
  SALON_PAYEE,
  payeeCheckoutMetadata,
  resolvePayeeFromCheckout,
  sessionsBlockedByPayeeChange,
} from "@/lib/payments/resolve-payee";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const JULIE = { id: "s_julie", type: "INDEPENDENT", userId: "u_julie", isDeleted: false, stripeAccountId: "acct_julie", stripeChargesEnabled: true, stripePayoutsEnabled: true };

// Everything an independent is assigned to is charged on her own Stripe
// account — appointments already were; ateliers and formations she animates
// now are too. The payee is frozen at checkout and read back by the webhook.
describe("the payee travels with the Checkout Session", () => {
  it("is written as '' for the salon and as her Staff.id for an independent", () => {
    expect(payeeCheckoutMetadata(SALON_PAYEE)).toEqual({ [PAYEE_METADATA_KEY]: "" });
    expect(payeeCheckoutMetadata({ payeeStaffId: "s_julie", staff: JULIE })).toEqual({ [PAYEE_METADATA_KEY]: "s_julie" });
  });

  it("the webhook trusts the frozen payee over whoever animates the session now", async () => {
    const tx = { staff: { findUnique: vi.fn(() => Promise.resolve(JULIE)) } };
    const resolveNow = vi.fn(() => Promise.resolve(SALON_PAYEE));
    const payee = await resolvePayeeFromCheckout(tx, { metadata: { payeeStaffId: "s_julie" } }, resolveNow);
    expect(payee.payeeStaffId).toBe("s_julie");
    expect(resolveNow).not.toHaveBeenCalled();
  });

  it("an empty frozen payee is the salon, even if an independent animates the session now", async () => {
    const resolveNow = vi.fn();
    expect(await resolvePayeeFromCheckout({}, { metadata: { payeeStaffId: "" } }, resolveNow)).toEqual(SALON_PAYEE);
    expect(resolveNow).not.toHaveBeenCalled();
  });

  it("a session created before payees existed falls back to resolving now", async () => {
    const resolveNow = vi.fn(() => Promise.resolve(SALON_PAYEE));
    await resolvePayeeFromCheckout({}, { metadata: { kind: "workshop" } }, resolveNow);
    expect(resolveNow).toHaveBeenCalledOnce();
  });
});

describe("an atelier/formation seat is charged to its animator's account", () => {
  test.each([
    ["workshop", "actions/workshops/create-workshop-reservation.js", "resolvePayeeForWorkshopSession"],
    ["formation", "actions/formations/create-formation-reservation.js", "resolvePayeeForFormationSession"],
  ])("%s checkout", (_kind, path, resolver) => {
    const code = source(path);
    expect(code).toContain(`const payee = await ${resolver}(prisma, { sessionId: session.id });`);
    expect(code).toContain("if (!payeeCanChargeOnline(payee)) {");
    // The params come from the one shared builder (see the test below) and the
    // direct-charge option from the SAME payee — passing one without the other
    // would charge one account while the metadata claims a different owner.
    expect(code).toContain("buildActivityCheckoutParams(RELANCE_KINDS.");
    expect(code).toContain("{ payee }),");
    expect(code).toContain("payeeStripeOptions(payee)");
    // the free-seat path builds its own synthetic session, so it has to freeze
    // the payee by hand
    expect(code).toContain("...payeeCheckoutMetadata(payee)");
    // the salon's legal identity only gates a sale the salon invoices
    expect(code).toContain("if (!payee.staff && !(await isSellerLegalDataComplete())) {");
  });

  // The booking checkouts and the staff "Relancer le paiement" share this
  // builder. When the payee lived inline in the two booking actions, a relance
  // for an independent's seat silently rebuilt the checkout on the salon's
  // account — the first charge on hers, the replacement on the salon's.
  test("the shared activity checkout builder carries the payee for every caller", () => {
    const code = source("lib/reservations/activity-payment-relance.js");
    expect(code).toContain("payee = SALON_PAYEE");
    // frozen in both the session and the payment intent metadata
    expect(code.match(/\.\.\.payeeCheckoutMetadata\(payee\)/g)).toHaveLength(2);
    // A connected account serves its own methods; naming one it has not
    // activated is a 400 that kills the checkout (iDEAL, 17/09/2026).
    expect(code).toContain('...(payee.staff ? {} : { payment_method_types: ["card", "bancontact"] })');
    expect(code).not.toContain('"ideal"');
  });

  test.each([
    ["lib/workshops/fulfill-workshop-reservation-payment.js", "confirmWorkshopReservationPayment"],
    ["lib/formations/fulfill-formation-reservation-payment.js", "confirmFormationReservationPayment"],
  ])("%s records the frozen payee and the account the money landed on", (path, fn) => {
    const code = source(path);
    expect(code).toContain(`export async function ${fn}(session, { stripeAccountId = null } = {}) {`);
    expect(code).toContain("await resolvePayeeFromCheckout(tx, session, () =>");
    expect(code).toContain("{ stripeAccountId }\n        ),");
    // every manual-refund case points at the Stripe account the charge is on
    expect(code.match(/, \{ stripeAccountId \}\);/g)).toHaveLength(5);
  });

  test("the webhook hands event.account to the atelier/formation confirmations and fee handlers", () => {
    const route = source("app/api/webhooks/stripe/route.js");
    expect(route).toContain("const stripeAccountId = event.account ?? null;");
    expect(route).toContain("confirmWorkshopReservationPayment(session, { stripeAccountId })");
    expect(route).toContain("confirmFormationReservationPayment(session, { stripeAccountId: event.account ?? null })");
    expect(route).toContain("applyWorkshopSeatsChangeFee(session, session.metadata, stripeAccountId)");
  });

  test("a seat-change fee is charged to whoever owns the booking, not re-derived from the session", () => {
    const code = source("actions/workshops/manage-reservation.js");
    expect(code).toContain("await resolvePayeeForStaff(prisma, { staffId: reservation.payment?.payeeStaffId ?? null });");
  });

  test("every appointment checkout records the connected account the charge was made on", () => {
    for (const path of [
      "actions/payment/createCheckoutSession.js",
      "actions/appointment/create-manual-appointment.js",
      "actions/appointment/confirm-accepted-appointment.js",
      "lib/appointments/accepted-payment.js",
      "actions/payment/resume-reservation-payment.js",
      "actions/payment/resend-payment-email.js",
    ]) {
      expect(source(path), path).toMatch(/transactionReference: \w+\.id, stripeAccountId: [\w.]+\.stripeAccountId \}/);
    }
  });
});

// Money cannot follow a seat from one Stripe account to another.
describe("a paid booking never changes owner", () => {
  test.each(["actions/workshops/manage-reservation.js", "actions/formations/manage-reservation.js"])(
    "%s refuses a transfer to a session with a different payee",
    (path) => {
      const code = source(path);
      expect(code).toContain("if ((targetPayee.payeeStaffId ?? null) !== (payment.payeeStaffId ?? null)) {");
      expect(code).toContain('throw new Error("TRANSFER_PAYEE_MISMATCH");');
      expect(code).toContain("TRANSFER_PAYEE_MISMATCH:");
    }
  );

  test.each(["actions/workshops/create-activity.js", "actions/formations/create-formation.js"])(
    "%s refuses an animator change on a session that already holds someone else's payment",
    (path) => {
      const code = source(path);
      expect(code).toContain("await sessionsBlockedByPayeeChange(");
      expect(code).toContain("return { success: false, message: PAYEE_CHANGE_ON_PAID_SESSION_MESSAGE };");
    }
  );

  function txMock({ animatorStaff = {}, conflicting = null } = {}) {
    return {
      animator: { findUnique: vi.fn(({ where }) => Promise.resolve({ staffId: animatorStaff[where.id] ?? null })) },
      staff: { findUnique: vi.fn(({ where }) => Promise.resolve(where.id === "s_julie" ? JULIE : null)) },
      user: { findMany: vi.fn(() => Promise.resolve([{ id: "u_admin", staff: null }])) },
      payment: { findFirst: vi.fn(() => Promise.resolve(conflicting)) },
    };
  }

  it("ignores a session whose animator did not change", async () => {
    const tx = txMock({ conflicting: { id: "p1" } });
    const blocked = await sessionsBlockedByPayeeChange(tx, "WORKSHOP", [
      { sessionId: "ws1", currentAnimatorId: "a1", nextAnimatorId: "a1" },
    ]);
    expect(blocked).toEqual([]);
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
  });

  it("blocks handing a session with salon-paid seats to an independent", async () => {
    const tx = txMock({ animatorStaff: { a_julie: "s_julie" }, conflicting: { id: "p1" } });
    const blocked = await sessionsBlockedByPayeeChange(tx, "FORMATION", [
      { sessionId: "fs1", currentAnimatorId: "a_outside", nextAnimatorId: "a_julie" },
    ]);
    expect(blocked).toEqual(["fs1"]);
    const where = tx.payment.findFirst.mock.calls[0][0].where;
    expect(where.formationReservation).toEqual({ sessionId: "fs1" });
    expect(where.OR).toEqual([{ payeeStaffId: null }, { payeeStaffId: { not: "s_julie" } }]);
  });

  it("taking a session back to the salon looks for any independent-owned payment", async () => {
    const tx = txMock({ animatorStaff: { a_julie: "s_julie" } });
    const blocked = await sessionsBlockedByPayeeChange(tx, "WORKSHOP", [
      { sessionId: "ws1", currentAnimatorId: "a_julie", nextAnimatorId: null },
    ]);
    expect(blocked).toEqual([]);
    expect(tx.payment.findFirst.mock.calls[0][0].where).toEqual({
      workshopReservation: { sessionId: "ws1" },
      payeeStaffId: { not: null },
    });
  });
});
