import { describe, expect, test } from "vitest";
import { resolveSeatChange, SEAT_CHANGE_ERRORS } from "@/lib/reservations/seat-change-pricing";

describe("free seat-change pricing", () => {
  test("prices the new seat count off the catalogue unit price, not totalPrice / currentSeats", () => {
    // A prior counter adjustment or promo already bent totalPrice away from
    // unitPrice * currentSeats — resolveSeatChange must ignore that entirely
    // and re-derive from the catalogue price every time.
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 2,
      newSeats: 3,
      paidAmount: 40, // a discounted total was paid, nowhere near unitPrice * 2
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: true, unitPrice: 50, newTotal: 150 });
  });

  test("does not re-apply a promo code per added seat — the discount is frozen, not re-resolved", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 2,
      newSeats: 4,
      discountAmount: 10, // frozen amount, not a percentage of the growing total
      paidAmount: 0,
      capacity: 10,
      occupiedByOthers: 0,
    });
    // gross = 50 * 4 = 200, minus the frozen 10 — a re-applied 10 EUR-per-seat
    // discount would instead subtract 40.
    expect(result).toMatchObject({ success: true, newTotal: 190, discountAmount: 10 });
  });

  test("a validated foreign-EU buyer is repriced at 0% instead of the stored 21% TTC", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 121, // 100 HT at 21%
      vatRate: 0,
      currentSeats: 1,
      newSeats: 2,
      paidAmount: 0,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result.unitPrice).toBeCloseTo(100, 2);
    expect(result.newTotal).toBeCloseTo(200, 2);
  });

  test("refuses to go below the number of seats already checked in", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 4,
      newSeats: 1,
      checkedInSeats: 2,
      paidAmount: 200,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: false, code: SEAT_CHANGE_ERRORS.SEATS_BELOW_CHECKED_IN });
  });

  test("a seat change that only exchanges partial arrival for a lower headcount above what already checked in succeeds", () => {
    // Deliberately weaker than the session-transfer guard: 2 of 4 already
    // arrived, dropping to 2 must still work.
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 4,
      newSeats: 2,
      checkedInSeats: 2,
      paidAmount: 100,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: true, newSeats: 2, newTotal: 100 });
  });

  test("refuses at the session's capacity ceiling", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 2,
      newSeats: 6,
      paidAmount: 0,
      capacity: 10,
      occupiedByOthers: 5, // 5 + 6 > 10
    });
    expect(result).toMatchObject({ success: false, code: SEAT_CHANGE_ERRORS.SESSION_FULL });
  });

  test("refuses rather than clamps when paidAmount already exceeds the new (lower) total", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 4,
      newSeats: 2, // new total 100, but 150 was already paid for 4 seats
      paidAmount: 150,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: false, code: SEAT_CHANGE_ERRORS.OVERPAYMENT_REQUIRES_MANUAL_HANDLING });
    // Never silently offers a clamped figure alongside the refusal.
    expect(result.newTotal).toBeUndefined();
  });

  test("refuses a no-op seat count instead of silently succeeding", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 3,
      newSeats: 3,
      paidAmount: 150,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: false, code: SEAT_CHANGE_ERRORS.SAME_SEATS });
  });

  test("rejects a non-integer or non-positive seat count", () => {
    expect(
      resolveSeatChange({ catalogueUnitPriceTtc: 50, vatRate: 21, currentSeats: 2, newSeats: 0, capacity: 10 })
    ).toMatchObject({ success: false, code: SEAT_CHANGE_ERRORS.INVALID_SEATS });
    expect(
      resolveSeatChange({ catalogueUnitPriceTtc: 50, vatRate: 21, currentSeats: 2, newSeats: 2.5, capacity: 10 })
    ).toMatchObject({ success: false, code: SEAT_CHANGE_ERRORS.INVALID_SEATS });
  });

  test("newStatus reflects PENDING when nothing has been paid at all", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 1,
      newSeats: 2,
      paidAmount: 0,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: true, newStatus: "PENDING" });
  });

  test("newStatus reflects PARTIALLY_PAID when some but not all of the new total is covered", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 1,
      newSeats: 2, // newTotal 100
      paidAmount: 50,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: true, newStatus: "PARTIALLY_PAID", newBalance: 50 });
  });

  test("newStatus reflects PAID and a zero balance once the new total is fully covered", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 50,
      vatRate: 21,
      currentSeats: 3,
      newSeats: 2, // newTotal 100, decrease keeps the deposit as-is
      paidAmount: 100,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result).toMatchObject({ success: true, newStatus: "PAID", newBalance: 0 });
  });

  test("rounds to the cent so newTotal = paidAmount + newBalance exactly", () => {
    const result = resolveSeatChange({
      catalogueUnitPriceTtc: 33.33,
      vatRate: 21,
      currentSeats: 1,
      newSeats: 3,
      paidAmount: 33.33,
      capacity: 10,
      occupiedByOthers: 0,
    });
    expect(result.success).toBe(true);
    expect(Math.round((result.paidAmount + result.newBalance) * 100) / 100).toBe(result.newTotal);
  });
});
