import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  appointmentCollectsAtCounter,
  appointmentAmountDueAtCounter,
} from "@/lib/appointments/counter-collection";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Completing an appointment that was never prepaid.
 *
 * A Payment row is only created when money is taken online at booking —
 * `shouldCreatePaymentRecord` in lib/reservation-payment.js is literally
 * `requiresOnlinePaymentNow`. So an appointment booked "payer au salon",
 * taken in MANUAL confirmation mode, or created by staff has no Payment row
 * at all, and `completeAppointment`'s `hasBalanceDue` began with
 * `Boolean(payment)`.
 *
 * The consequence was not a missing row on a screen. Completing one of these
 * wrote a single status change and nothing else: no Transaction, no cash-book
 * piece number, no link to the open till session, no invoice — and therefore
 * nothing in Opérations, nothing in the Z-closure, and no record anywhere
 * that the service had been paid for. Measured on the dev database when this
 * was found: 55 of 103 upcoming CONFIRMED appointments had no Payment row.
 *
 * Two screens decide whether to ask for a payment method, and they disagreed
 * — the calendar drawer recognised only PARTIALLY_PAID, so even an ordinary
 * PENDING/ON_SITE balance could not be settled from the calendar. Hence one
 * shared predicate, tested here as a pure function, plus source assertions
 * that the server applies the same rule. The server is the authority; the
 * predicate only decides whether the dialog opens.
 */

const row = (over = {}) => ({ paymentStatus: null, paymentType: null, servicePrice: 60, ...over });

describe("who has to pay at the counter", () => {
  test("a deposit paid online leaves a balance to collect", () => {
    expect(appointmentCollectsAtCounter(row({ paymentStatus: "PARTIALLY_PAID" }))).toBe(true);
  });

  test("a Payment row that was never collected still needs collecting", () => {
    expect(
      appointmentCollectsAtCounter(row({ paymentStatus: "PENDING", paymentType: "ON_SITE" })),
    ).toBe(true);
  });

  test("no Payment row at all is the case that was being missed", () => {
    // The regression this whole change exists for.
    expect(appointmentCollectsAtCounter(row())).toBe(true);
  });

  test("a free service still completes in one click", () => {
    // Deliberately a price test rather than a null-payment test: charging
    // nothing is a real case and must not grow a payment dialog.
    expect(appointmentCollectsAtCounter(row({ servicePrice: 0 }))).toBe(false);
  });

  test("an appointment already paid in full collects nothing", () => {
    expect(
      appointmentCollectsAtCounter(row({ paymentStatus: "PAID", paymentType: "ONLINE" })),
    ).toBe(false);
  });

  test("the calendar's row shape is read too", () => {
    // The list serialises the figure as `servicePrice`, the calendar as
    // `price`. One predicate serves both, so it has to read both — a screen
    // whose field name is not understood would silently go back to
    // completing without collecting.
    expect(appointmentCollectsAtCounter({ paymentStatus: null, price: 45 })).toBe(true);
    expect(appointmentCollectsAtCounter({ paymentStatus: null, price: null })).toBe(false);
  });

  test("a missing row is not a collection", () => {
    expect(appointmentCollectsAtCounter(null)).toBe(false);
    expect(appointmentCollectsAtCounter(undefined)).toBe(false);
  });
});

describe("what the dialog says is owed", () => {
  test("a balance is the part not yet paid", () => {
    expect(
      appointmentAmountDueAtCounter({ paymentStatus: "PARTIALLY_PAID", totalAmount: 60, paidAmount: 30 }),
    ).toBe(30);
  });

  test("with no Payment row it is the whole quoted price", () => {
    // totalAmount and paidAmount are both null here, and the drawer's old
    // expression collapsed to null — it would have offered to collect
    // nothing for a service that has a price.
    expect(appointmentAmountDueAtCounter(row({ servicePrice: 60 }))).toBe(60);
    expect(appointmentAmountDueAtCounter({ paymentStatus: null, price: 45 })).toBe(45);
  });

  test("an overpaid row never shows a negative amount", () => {
    expect(
      appointmentAmountDueAtCounter({ paymentStatus: "PAID", totalAmount: 60, paidAmount: 80 }),
    ).toBe(0);
  });
});

describe("the server applies the same rule, and is the one that matters", () => {
  const action = source("actions/appointment/manage-appointment.js");

  test("the on-site collection is derived from the service price", () => {
    expect(action).toContain("const onSitePrice = Number(appointment.staffService?.price ?? 0);");
    expect(action).toContain("const collectsOnSite = !payment && priceAdjustment.amountDue > 0;");
    expect(action).toContain("const collectsMoney = hasBalanceDue || collectsOnSite;");
  });

  test("every attestation guard covers it, not just the balance case", () => {
    // The three guards exist because the system cannot observe a cash
    // handover or a terminal's APPROUVÉ screen. Leaving any one of them on
    // `hasBalanceDue` would let the new path record revenue nobody attested
    // to — which is the exact risk the guards were written for.
    // A card collection is accepted only as EXTERNAL_TERMINAL, which carries
    // the terminal's approval and its receipt reference. Bare "CARD" was
    // accepted with no evidence at all — of 29 card collections in the dev
    // database exactly one had a reference, so 28 could not be reconciled
    // against the terminal's end-of-day batch. Cash at least has a piece
    // number and an open till session behind it. The boutique POS and the
    // refund path already refused a referenceless card; settlement was the
    // last place that did not.
    expect(action).toContain('if (collectsMoney && !["CASH", "EXTERNAL_TERMINAL"].includes(method))');
    expect(action, "a card collection was accepted without a terminal reference").not.toContain(
      '["CASH", "CARD", "EXTERNAL_TERMINAL"]',
    );
    expect(action).toContain('if (collectsMoney && method === "EXTERNAL_TERMINAL"');
    expect(action).toContain("if (collectsMoney && paymentConfirmed !== true)");
    // And none are left behind.
    expect(action).not.toMatch(/if \(hasBalanceDue &&/);
  });

  test("the Payment row is created when there is none", () => {
    expect(action).toContain("let updatedPayment = payment");
    expect(action).toContain('paymentType: "ON_SITE",');
  });

  test("a Payment row can only be created once per appointment", () => {
    // The create relies on Payment.appointmentId being @unique: if the
    // customer's own online payment lands between the read and this write,
    // P2002 rolls the completion back instead of recording the same service
    // as collected twice. That is a schema guarantee, so it is pinned here.
    expect(source("prisma/schema.prisma")).toContain("appointmentId          String?               @unique");
  });

  test("the ticket does not call a first payment a balance", () => {
    expect(action).toContain('const collectedLabel = collectsOnSite ? "Le paiement" : "Le solde";');
    expect(action).not.toContain("Le solde de €${balance.toFixed(2)}");
  });
});

describe("both screens ask the shared question", () => {
  test("the appointments list", () => {
    const client = source("components/dashboard/appointments/AppointmentsPageClient.jsx");
    expect(client).toContain("appointmentCollectsAtCounter(row)");
    expect(client).not.toMatch(/row\.payment\?\.status === "PARTIALLY_PAID" \|\|/);
  });

  test("the calendar drawer, which used to recognise only PARTIALLY_PAID", () => {
    const drawer = source("components/dashboard/calendar/AppointmentDrawer.jsx");
    expect(drawer).toContain("appointmentCollectsAtCounter(appointment)");
    expect(drawer).not.toContain('if (appointment.paymentStatus === "PARTIALLY_PAID") {');
  });

  test("and the list row carries the price the predicate needs", () => {
    // Without this the screen cannot tell a free service from an unrecorded
    // paid one, and would either prompt for €0 or skip a real collection.
    expect(source("actions/appointment/get-all-appointments.js")).toContain("servicePrice:");
  });
});
