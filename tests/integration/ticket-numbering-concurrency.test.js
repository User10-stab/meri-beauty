import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { testTag } from "./helpers.js";

// Real Postgres row locks are the entire point here — same reasoning as
// tests/integration/concurrency.test.js, applied to the new global ticket
// sequence (lib/tickets/allocate-ticket-number.js) instead of stock/seat
// locking. Nothing is mocked: this calls the exact same allocator functions
// production settlement code calls, against a real (disposable) database.
const { prisma } = await import("@/lib/prisma");
const { allocateOrderTicketNumber, allocatePaymentTicketNumber, ticketYear } = await import(
  "@/lib/tickets/allocate-ticket-number"
);

const tag = testTag();
const year = ticketYear();
const counterKey = `TICKET-${year}`;

async function currentCounterValue() {
  const row = await prisma.numberingCounter.findUnique({ where: { key: counterKey } });
  return row?.lastNumber ?? 0;
}

function seqOf(ticketNumber) {
  return Number.parseInt(ticketNumber.slice(`T-${year}-`.length), 10);
}

describe("real concurrency: the shared global ticket counter", () => {
  let orderA, orderB, orderC, orderForPayment, payment;

  beforeAll(async () => {
    const baseOrder = { fulfilmentMode: "PICKUP_ON_SITE", subtotal: 10, totalAmount: 10 };
    [orderA, orderB, orderC, orderForPayment] = await Promise.all([
      prisma.order.create({ data: { ...baseOrder } }),
      prisma.order.create({ data: { ...baseOrder } }),
      prisma.order.create({ data: { ...baseOrder } }),
      prisma.order.create({ data: { ...baseOrder } }),
    ]);
    payment = await prisma.payment.create({
      data: {
        orderId: orderForPayment.id,
        totalAmount: 10,
        paidAmount: 10,
        remainingAmount: 0,
        paymentType: "ON_SITE",
        status: "PAID",
      },
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { id: payment.id } });
    await prisma.order.deleteMany({ where: { id: { in: [orderA.id, orderB.id, orderC.id, orderForPayment.id] } } });
  });

  test("two simultaneous first-time allocations get distinct, adjacent numbers", async () => {
    const [ticketA, ticketB] = await Promise.all([
      prisma.$transaction((tx) => allocateOrderTicketNumber(tx, orderA.id)),
      prisma.$transaction((tx) => allocateOrderTicketNumber(tx, orderB.id)),
    ]);

    expect(ticketA).not.toBe(ticketB);
    expect(ticketA).toMatch(new RegExp(`^T-${year}-\\d{6}$`));
    expect(ticketB).toMatch(new RegExp(`^T-${year}-\\d{6}$`));
    // The row lock on NumberingCounter serializes the two concurrent
    // callers — with nothing else touching this disposable branch at the
    // same instant, they must land on consecutive numbers, in whichever
    // order the lock actually granted them.
    expect(Math.abs(seqOf(ticketA) - seqOf(ticketB))).toBe(1);

    const freshA = await prisma.order.findUniqueOrThrow({ where: { id: orderA.id } });
    const freshB = await prisma.order.findUniqueOrThrow({ where: { id: orderB.id } });
    expect(freshA.ticketNumber).toBe(ticketA);
    expect(freshB.ticketNumber).toBe(ticketB);
    expect(freshA.ticketKind).toBe("ORDER");
  });

  test("a rolled-back transaction does not burn a number", async () => {
    const before = await currentCounterValue();

    await expect(
      prisma.$transaction(async (tx) => {
        await allocateOrderTicketNumber(tx, orderC.id);
        throw new Error("INTENTIONAL_ROLLBACK");
      }),
    ).rejects.toThrow("INTENTIONAL_ROLLBACK");

    // The failed attempt must have left absolutely no trace: neither the
    // counter nor the row it was writing to.
    const afterRollback = await currentCounterValue();
    expect(afterRollback).toBe(before);
    const freshC = await prisma.order.findUniqueOrThrow({ where: { id: orderC.id } });
    expect(freshC.ticketNumber).toBeNull();

    // A real, successful allocation right after must claim the very next
    // number — proof the rollback left no gap and wasted nothing.
    const realTicket = await prisma.$transaction((tx) => allocateOrderTicketNumber(tx, orderC.id));
    expect(seqOf(realTicket)).toBe(before + 1);
    const afterReal = await currentCounterValue();
    expect(afterReal).toBe(before + 1);
  });

  test("allocating twice for the same Payment across two separate transactions is a no-op the second time", async () => {
    const before = await currentCounterValue();

    const first = await prisma.$transaction((tx) => allocatePaymentTicketNumber(tx, payment.id, "APPOINTMENT"));
    const afterFirst = await currentCounterValue();
    expect(afterFirst).toBe(before + 1);

    // A second, later transaction — modelling the "acompte now, solde weeks
    // later" case where more than one settlement path could plausibly call
    // this for the same Payment.
    const second = await prisma.$transaction((tx) => allocatePaymentTicketNumber(tx, payment.id, "APPOINTMENT"));
    const afterSecond = await currentCounterValue();

    expect(second).toBe(first);
    expect(afterSecond).toBe(afterFirst); // the counter must not have moved again

    const freshPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(freshPayment.ticketNumber).toBe(first);
    expect(freshPayment.ticketKind).toBe("APPOINTMENT");
  });
});
