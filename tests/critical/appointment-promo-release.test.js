import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  releaseAppointmentPromoUse,
  releaseReservationPromoUse,
  reclaimReservationPromoUse,
} from "@/lib/promo-code-release";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

/**
 * A booking takes a PromoCode.usedCount use when it is made. Until
 * 2026-09-28 nothing gave it back for a rendez-vous, atelier or formation, so
 * abandoned, expired, rejected or cancelled bookings slowly used up a capped
 * code with zero real uses. Orders have their own release points.
 */
function makeTx(row, { cleared = row?.promoUseClaimed ? 1 : 0 } = {}) {
  const delegate = () => ({
    findUnique: vi.fn().mockResolvedValue(row),
    updateMany: vi.fn().mockResolvedValue({ count: cleared }),
  });
  return {
    payment: delegate(),
    workshopReservation: delegate(),
    formationReservation: delegate(),
    promoCode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

const giveBack = (promoCodeId) => ({
  where: { id: promoCodeId, usedCount: { gt: 0 } },
  data: { usedCount: { decrement: 1 } },
});

describe("a cancelled rendez-vous gives its promo use back", () => {
  test("a claimed use is released exactly once, guarded on the flag", async () => {
    const tx = makeTx({ id: "pay-1", promoCodeId: "promo-1", promoUseClaimed: true });
    await releaseAppointmentPromoUse(tx, "appt-1");

    expect(tx.payment.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { appointmentId: "appt-1" } }));
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay-1", promoUseClaimed: true },
      data: { promoUseClaimed: false },
    });
    expect(tx.promoCode.updateMany).toHaveBeenCalledWith(giveBack("promo-1"));
  });

  test("an appointment booked before uses were claimed gives nothing back", async () => {
    const tx = makeTx({ id: "pay-1", promoCodeId: "promo-1", promoUseClaimed: false });
    await releaseAppointmentPromoUse(tx, "appt-1");
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
  });

  test("a second, racing release is a no-op", async () => {
    // The other path cleared the flag first.
    const tx = makeTx({ id: "pay-1", promoCodeId: "promo-1", promoUseClaimed: true }, { cleared: 0 });
    await releaseAppointmentPromoUse(tx, "appt-1");
    expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
  });

  test("no payment or no code: nothing to release", async () => {
    for (const payment of [null, { id: "pay-1", promoCodeId: null, promoUseClaimed: false }]) {
      const tx = makeTx(payment);
      await releaseAppointmentPromoUse(tx, "appt-1");
      expect(tx.promoCode.updateMany).not.toHaveBeenCalled();
    }
  });
});

describe("a cancelled atelier / formation gives its promo use back", () => {
  test.each([
    ["WORKSHOP", "workshopReservation"],
    ["FORMATION", "formationReservation"],
  ])("%s: released once, on its own model, guarded on the flag", async (kind, model) => {
    const tx = makeTx({ promoCodeId: "promo-1", promoUseClaimed: true });
    await releaseReservationPromoUse(tx, kind, "res-1");

    expect(tx[model].updateMany).toHaveBeenCalledWith({
      where: { id: "res-1", promoUseClaimed: true },
      data: { promoUseClaimed: false },
    });
    expect(tx.promoCode.updateMany).toHaveBeenCalledWith(giveBack("promo-1"));
  });

  test("a booking that never took a use, or a racing second release, gives nothing back", async () => {
    const legacy = makeTx({ promoCodeId: "promo-1", promoUseClaimed: false });
    await releaseReservationPromoUse(legacy, "WORKSHOP", "res-1");
    expect(legacy.promoCode.updateMany).not.toHaveBeenCalled();

    const raced = makeTx({ promoCodeId: "promo-1", promoUseClaimed: true }, { cleared: 0 });
    await releaseReservationPromoUse(raced, "FORMATION", "res-1");
    expect(raced.promoCode.updateMany).not.toHaveBeenCalled();
  });

  test("an unknown kind is a programming error, not a silent leak", async () => {
    await expect(releaseReservationPromoUse(makeTx(null), "APPOINTMENT", "res-1")).rejects.toThrow(/unknown reservation kind/);
  });
});

describe("a relance that revives an expired hold takes the use again", () => {
  test("a released hold re-claims one use, capped by the code's limit", async () => {
    const tx = makeTx({ promoCodeId: "promo-1", promoUseClaimed: false }, { cleared: 1 });
    await reclaimReservationPromoUse(tx, "WORKSHOP", "res-1");

    expect(tx.workshopReservation.updateMany).toHaveBeenCalledWith({
      where: { id: "res-1", promoUseClaimed: false },
      data: { promoUseClaimed: true },
    });
    const sql = tx.$executeRaw.mock.calls[0][0].join("?");
    expect(sql).toContain('"usedCount" = "usedCount" + 1');
    expect(sql).toContain('("maxUses" IS NULL OR "usedCount" < "maxUses")');
  });

  test("a code used up meanwhile stops the relance", async () => {
    const tx = makeTx({ promoCodeId: "promo-1", promoUseClaimed: false }, { cleared: 1 });
    tx.$executeRaw.mockResolvedValue(0);
    await expect(reclaimReservationPromoUse(tx, "FORMATION", "res-1")).rejects.toThrow("PROMO_EXHAUSTED");
  });

  test("a hold that still holds its use (never lapsed) takes nothing more", async () => {
    const tx = makeTx({ promoCodeId: "promo-1", promoUseClaimed: true });
    await reclaimReservationPromoUse(tx, "WORKSHOP", "res-1");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  test("the relance calls it inside its hold transaction and explains a used-up code", () => {
    const relance = source("actions/payments/resend-activity-payment.js");
    expect(relance).toContain("await reclaimReservationPromoUse(tx, kind, reservation.id)");
    expect(relance).toContain("PROMO_EXHAUSTED:");
  });
});

describe("every booking path flags its use and every cancellation releases it", () => {
  test("booking paths flag the use they claim", () => {
    for (const path of [
      "actions/payment/createCheckoutSession.js",
      "actions/reservation/create-reservation.js",
      "actions/workshops/create-workshop-reservation.js",
      "actions/formations/create-formation-reservation.js",
    ]) {
      expect(source(path), path).toContain("promoUseClaimed: Boolean(promoCodeId)");
    }
  });

  test("every path that cancels or rejects a rendez-vous releases its use", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "actions/reservation/cancel-reservation.js",
      "lib/appointments/expire-stale-appointments.js",
      "lib/payments/reconcile-reservation-refund.js",
      "lib/refunds/open-refund-operation.js",
    ]) {
      expect(source(path), path).toContain("await releaseAppointmentPromoUse(tx, ");
    }
  });

  test("every path that cancels an atelier / formation booking releases its use", () => {
    for (const [path, occurrences] of [
      ["actions/workshops/manage-reservation.js", 1],
      ["actions/formations/manage-reservation.js", 1],
      ["actions/workshops/create-workshop-reservation.js", 1],
      ["actions/formations/create-formation-reservation.js", 1],
      ["lib/workshops/fulfill-workshop-reservation-payment.js", 1],
      ["lib/formations/fulfill-formation-reservation-payment.js", 1],
      ["lib/workshops/expire-stale-holds.js", 1],
      ["lib/formations/expire-stale-holds.js", 1],
      ["lib/payments/reconcile-reservation-refund.js", 1],
      ["lib/refunds/open-refund-operation.js", 1],
    ]) {
      const calls = source(path).split("await releaseReservationPromoUse(tx, ").length - 1;
      expect(calls, path).toBe(occurrences);
    }
  });
});
