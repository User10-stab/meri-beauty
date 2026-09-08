import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const core = source("lib/reservations/change-reservation-seats.js");
const pricing = source("lib/reservations/seat-change-pricing.js");

describe.each([["WORKSHOP"], ["FORMATION"]])("free counter seat change — %s", (kind) => {
  test("is free — no Stripe, no fee, never the paid flow's naming", () => {
    // The file's own docstring explains it is NOT the Stripe flow (contrast
    // with changeReservationSeats) — that mention of the word is expected.
    // What must never appear is an actual import of or call into Stripe.
    expect(core).not.toContain('from "@/lib/stripe"');
    expect(core).not.toContain("stripe.checkout");
    expect(core).not.toContain("changeFeeAmount");
    expect(core).not.toContain("SESSION_CHANGE_FEE_RATE");
    // The free flow never redefines or reassigns changeReservationSeats —
    // that name stays the customer's 10%-fee Stripe flow, pinned by
    // tests/critical/activity-check-in-contracts.test.js.
    expect(core).not.toContain("export async function changeReservationSeats(");
  });

  test("locks the reservation, then the session, before the occupancy aggregate", () => {
    const reservationLock = core.indexOf("FOR UPDATE`");
    const sessionLockComment = core.indexOf("Lock order identical to changeReservationSession");
    const occupancyCall = core.indexOf("sessionOccupancy(tx");
    expect(reservationLock).toBeGreaterThan(-1);
    expect(sessionLockComment).toBeGreaterThan(-1);
    expect(occupancyCall).toBeGreaterThan(reservationLock);
    // Two FOR UPDATE locks exist: reservation table, then session table.
    expect((core.match(/FOR UPDATE`/g) || []).length).toBe(2);
  });

  test("excludes the reservation's own current seats from the occupancy count", () => {
    expect(core).toContain("excludeReservationId: reservation.id");
  });

  test("prices off the catalogue price, never a division of totalPrice", () => {
    expect(pricing).toContain("repriceTtcCataloguePrice(catalogueUnitPriceTtc, vatRate)");
    // resolveSeatChange's parameter list never accepts a totalPrice at all —
    // structurally, no expression inside the function body can divide one
    // back into a "unit" price. Only the JSDoc/comments name it, to explain
    // the trap being avoided.
    const body = pricing.slice(pricing.indexOf("export function resolveSeatChange"));
    const codeOnly = body.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/\btotalPrice\b/);
    expect(core).toContain("catalogueUnitPriceTtc: Number(catalogue.price)");
  });

  test("refuses rather than clamps an overpayment", () => {
    expect(pricing).toContain("OVERPAYMENT_REQUIRES_MANUAL_HANDLING");
    // No Math.min/clamp of paidAmount against newTotal anywhere near the guard.
    expect(pricing).not.toContain("Math.min(paidAmount, newTotal)");
  });

  test("a seat count below what's already checked in is refused, not below what's merely non-zero", () => {
    expect(pricing).toContain("SEATS_BELOW_CHECKED_IN");
    expect(pricing).toContain("newSeatsCount < Number(checkedInSeats)");
    // Must not copy changeReservationSession's stricter "any check-in blocks
    // the change at all" guard.
    expect(core).not.toContain("checkedInSeats > 0) throw");
  });

  test("supersedes an existing invoice, and only reissues once the new balance is fully covered", () => {
    expect(core).toContain("supersedeInvoice(tx");
    expect(core).toContain("pricing.newBalance <= 0.01");
    expect(core).toContain("supersedesInvoiceId: payment.invoice.id");
  });

  test("the discount is frozen, never re-resolved against the promo code", () => {
    expect(core).not.toContain("resolvePromoCode");
    expect(core).toContain("const discountAmount = money(payment.discountAmount ?? reservation.discountAmount)");
  });

  test("uses a 15s transaction timeout, matching the session-transfer flow", () => {
    expect(core).toContain("timeout: 15_000");
  });

  test("is auditable under its own action", () => {
    expect(core).toContain("AUDIT_ACTIONS.RESERVATION_SEATS_CHANGED");
    expect(source("lib/audit-log.js")).toContain('RESERVATION_SEATS_CHANGED: "reservation.seats_changed"');
  });
});

describe("the auth-gated wrappers", () => {
  test("workshops: gated on ACTIVITY_SETTLEMENTS, not admin-only", () => {
    const wrapper = source("actions/workshops/manage-reservation.js");
    expect(wrapper).toContain("export async function changeWorkshopReservationSeatsFree(");
    // Same authorizeActivityReservationOperation call as completeWorkshopReservation
    // (the settlement action), not an isAdminRole-only gate.
    const start = wrapper.indexOf("export async function changeWorkshopReservationSeatsFree(");
    const body = wrapper.slice(start, start + 900);
    expect(body).toContain("authorizeActivityReservationOperation({");
    expect(body).toContain("capability: STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS");
    expect(body).toContain("changeReservationSeatsFree({");
    expect(body).toContain('kind: "WORKSHOP"');
  });

  test("formations: gated on ACTIVITY_SETTLEMENTS, not admin-only", () => {
    const wrapper = source("actions/formations/manage-reservation.js");
    expect(wrapper).toContain("export async function changeFormationReservationSeatsFree(");
    const start = wrapper.indexOf("export async function changeFormationReservationSeatsFree(");
    const body = wrapper.slice(start, start + 900);
    expect(body).toContain("authorizeActivityReservationOperation({");
    expect(body).toContain("capability: STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS");
    expect(body).toContain("changeReservationSeatsFree({");
    expect(body).toContain('kind: "FORMATION"');
  });
});

describe("the counter fiche exposes the free seat change, separately from the paid flow", () => {
  test("FicheSeatsAction calls the free wrappers, never the paid changeReservationSeats", () => {
    const action = source("components/dashboard/boutique/counter/FicheSeatsAction.jsx");
    expect(action).toContain("changeWorkshopReservationSeatsFree");
    expect(action).toContain("changeFormationReservationSeatsFree");
    expect(action).not.toMatch(/\bchangeReservationSeats\b(?!Free)/);
    // Absent entirely for an appointment — no seat concept there.
    const fiche = source("components/dashboard/boutique/counter/CounterFiche.jsx");
    expect(fiche).toContain('ticket.kind !== "appointment"');
  });

  test("the fiche remounts on a seat/price change, not just checkedInSeats/balanceDue", () => {
    const surface = source("components/dashboard/boutique/counter/CounterSurface.jsx");
    expect(surface).toContain("ticket.seatsCount");
    expect(surface).toContain("ticket.totalPrice");
  });
});

describe("changing seats stays out of the customer's paid Stripe flow (amended, not deleted)", () => {
  test("the 10% fee flow is untouched, and the free flow is confirmed to be a separate export", () => {
    const management = source("actions/workshops/manage-reservation.js");
    expect(management).toContain("const SESSION_CHANGE_FEE_RATE = 0.1");
    expect(management).toContain(
      "const changeFeeAmount = Number(reservation.totalPrice) * SESSION_CHANGE_FEE_RATE"
    );
    expect(management).toContain('workshopAction: "seats_change_fee"');
    // The free counter flow lives under its own name and never touches Stripe.
    expect(management).toContain("export async function changeWorkshopReservationSeatsFree(");
    const freeFlow = source("lib/reservations/change-reservation-seats.js");
    expect(freeFlow).not.toContain('from "@/lib/stripe"');
    expect(freeFlow).not.toContain("stripe.checkout");
  });
});
