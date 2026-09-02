import { describe, expect, it } from "vitest";
import {
  allocateRefund,
  classifyRefundReprise,
  planRefund,
  refundedByMethod,
  summarizeRefundState,
} from "@/lib/refunds/plan-refund";

/**
 * The payment-shape scenarios the "annuler et rembourser" handoff makes
 * mandatory. Every one of them is a question about the arithmetic alone, so
 * they run against the pure planner with no database and no Stripe.
 */

const t = (over) => ({
  id: over.id,
  amount: over.amount,
  method: over.method,
  transactionType: over.transactionType,
  paidAt: new Date(over.paidAt),
  isDeleted: false,
  stripeCheckoutSessionId: over.stripeCheckoutSessionId ?? null,
  stripePaymentIntentId: over.stripePaymentIntentId ?? null,
});

// The handoff's worked example: 21 € reservation, 50 % acompte online,
// balance settled at the counter.
const depositOnline = t({
  id: "tx-deposit",
  amount: 10.5,
  method: "ONLINE",
  transactionType: "DEPOSIT",
  paidAt: "2026-08-01T10:00:00Z",
  stripeCheckoutSessionId: "cs_test_1",
  stripePaymentIntentId: "pi_test_1",
});
const balanceCash = t({
  id: "tx-balance-cash",
  amount: 10.5,
  method: "CASH",
  transactionType: "FINAL_PAYMENT",
  paidAt: "2026-08-15T14:00:00Z",
});
const balanceCard = t({
  id: "tx-balance-card",
  amount: 10.5,
  method: "CARD",
  transactionType: "FINAL_PAYMENT",
  paidAt: "2026-08-15T14:00:00Z",
});

const invoice21 = { totalInclVat: 21, creditNotes: [] };

describe("planRefund — single-method payments", () => {
  it("refunds a Stripe-only deposit against its own transaction", () => {
    const plan = planRefund({ transactions: [depositOnline], invoice: { totalInclVat: 10.5, creditNotes: [] } });

    expect(plan.totalCollected).toBe(10.5);
    expect(plan.legs).toEqual([
      expect.objectContaining({ sourceTransactionId: "tx-deposit", method: "ONLINE", amount: 10.5 }),
    ]);
    expect(plan.automaticTotal).toBe(10.5);
    expect(plan.manualTotal).toBe(0);
    expect(plan.requiresManualConfirmation).toBe(false);
  });

  it("refunds a fully-online payment as one online leg", () => {
    const fullOnline = t({
      id: "tx-full",
      amount: 21,
      method: "ONLINE",
      transactionType: "FINAL_PAYMENT",
      paidAt: "2026-08-01T10:00:00Z",
      stripePaymentIntentId: "pi_full",
    });
    const plan = planRefund({ transactions: [fullOnline], invoice: invoice21 });

    expect(plan.plannedTotal).toBe(21);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].stripePaymentIntentId).toBe("pi_full");
  });
});

describe("planRefund — mixed payments (the bug this replaces)", () => {
  it("never asks Stripe for more than the online transaction actually took", () => {
    const plan = planRefund({ transactions: [depositOnline, balanceCash], invoice: invoice21 });

    // The old per-flow code sent Payment.paidAmount (21 €) to Stripe here.
    expect(plan.automaticTotal).toBe(10.5);
    expect(plan.manualTotal).toBe(10.5);
    expect(plan.plannedTotal).toBe(21);
  });

  it("produces one leg per original transaction, each with its own method", () => {
    const plan = planRefund({ transactions: [depositOnline, balanceCash], invoice: invoice21 });

    expect(plan.legs).toEqual([
      expect.objectContaining({ sourceTransactionId: "tx-deposit", method: "ONLINE", amount: 10.5 }),
      expect.objectContaining({ sourceTransactionId: "tx-balance-cash", method: "CASH", amount: 10.5 }),
    ]);
    expect(plan.requiresManualConfirmation).toBe(true);
  });

  it("treats a CARD balance as manual, exactly like cash", () => {
    const plan = planRefund({ transactions: [depositOnline, balanceCard], invoice: invoice21 });

    expect(plan.automaticTotal).toBe(10.5);
    expect(plan.legs.find((leg) => leg.method === "CARD")).toBeTruthy();
    expect(plan.requiresManualConfirmation).toBe(true);
  });
});

describe("allocateRefund — partial amounts", () => {
  it("unwinds the most recent payment first", () => {
    const legs = allocateRefund([depositOnline, balanceCash], 6);

    expect(legs).toEqual([
      expect.objectContaining({ sourceTransactionId: "tx-balance-cash", method: "CASH", amount: 6 }),
    ]);
  });

  it("spills onto the earlier payment only once the later one is drained", () => {
    const legs = allocateRefund([depositOnline, balanceCash], 15);

    expect(legs).toEqual([
      expect.objectContaining({ sourceTransactionId: "tx-deposit", amount: 4.5 }),
      expect.objectContaining({ sourceTransactionId: "tx-balance-cash", amount: 10.5 }),
    ]);
  });

  it("subtracts refunds already made on the same method", () => {
    const priorCashRefund = t({
      id: "tx-refund-1",
      amount: 10.5,
      method: "CASH",
      transactionType: "REFUND",
      paidAt: "2026-08-20T09:00:00Z",
    });

    expect(refundedByMethod([depositOnline, balanceCash, priorCashRefund])).toMatchObject({ CASH: 10.5 });

    const legs = allocateRefund([depositOnline, balanceCash, priorCashRefund], 10.5);
    expect(legs).toEqual([
      expect.objectContaining({ sourceTransactionId: "tx-deposit", method: "ONLINE", amount: 10.5 }),
    ]);
  });

  it("ignores soft-deleted transactions entirely", () => {
    const voided = { ...balanceCash, isDeleted: true };
    const plan = planRefund({ transactions: [depositOnline, voided], invoice: invoice21 });

    expect(plan.totalCollected).toBe(10.5);
    expect(plan.legs).toHaveLength(1);
  });
});

describe("summarizeRefundState — the five figures required before acting", () => {
  it("reports collected, refunded, credited and both remainders", () => {
    const state = summarizeRefundState({
      transactions: [depositOnline, balanceCash],
      invoice: { totalInclVat: 21, creditNotes: [{ totalInclVat: 5 }] },
    });

    expect(state).toMatchObject({
      totalCollected: 21,
      totalRefunded: 0,
      remainingRefundable: 21,
      invoiceTotal: 21,
      totalCredited: 5,
      remainingCreditable: 16,
    });
  });

  it("returns null creditable figures for a B2C sale with no invoice", () => {
    const state = summarizeRefundState({ transactions: [balanceCash], invoice: null });

    expect(state.invoiceTotal).toBeNull();
    expect(state.totalCredited).toBeNull();
    expect(state.remainingCreditable).toBeNull();
    expect(state.fullyCredited).toBe(false);
  });

  it("treats two partial notes summing to the invoice as fully credited", () => {
    const state = summarizeRefundState({
      transactions: [depositOnline, balanceCash],
      invoice: { totalInclVat: 21, creditNotes: [{ totalInclVat: 10.5 }, { totalInclVat: 10.5 }] },
    });

    expect(state.remainingCreditable).toBe(0);
    expect(state.fullyCredited).toBe(true);
  });

  it("flags a ledger that refunded more than it collected", () => {
    const overRefund = t({
      id: "tx-over",
      amount: 30,
      method: "ONLINE",
      transactionType: "REFUND",
      paidAt: "2026-08-20T09:00:00Z",
    });
    const state = summarizeRefundState({ transactions: [depositOnline, overRefund], invoice: invoice21 });

    expect(state.inconsistencies.map((i) => i.code)).toContain("REFUNDED_EXCEEDS_COLLECTED");
  });
});

describe("planRefund — refuses to plan what it cannot justify", () => {
  it("blocks entirely when the ledger is inconsistent", () => {
    const overRefund = t({
      id: "tx-over",
      amount: 30,
      method: "ONLINE",
      transactionType: "REFUND",
      paidAt: "2026-08-20T09:00:00Z",
    });
    const plan = planRefund({ transactions: [depositOnline, overRefund], invoice: invoice21 });

    expect(plan.blocked).toBe(true);
    expect(plan.legs).toEqual([]);
  });

  it("plans nothing when more is requested than remains refundable", () => {
    const plan = planRefund({ transactions: [depositOnline], invoice: invoice21, requestedAmount: 21 });

    expect(plan.overRequested).toBe(true);
    expect(plan.legs).toEqual([]);
  });

  it("plans nothing for a request with no payment actually collected", () => {
    const plan = planRefund({ transactions: [], invoice: null });

    expect(plan.totalCollected).toBe(0);
    expect(plan.remainingRefundable).toBe(0);
    expect(plan.legs).toEqual([]);
  });
});

describe("classifyRefundReprise — historical states", () => {
  const fullyRefunded = [
    depositOnline,
    t({ id: "r1", amount: 10.5, method: "ONLINE", transactionType: "REFUND", paidAt: "2026-08-20T09:00:00Z" }),
  ];

  it("asks only for the missing document when the money already went back", () => {
    expect(
      classifyRefundReprise({ transactions: fullyRefunded, invoice: { totalInclVat: 10.5, creditNotes: [] } }),
    ).toBe("DOCUMENT_ONLY");
  });

  it("resumes the refund when a full note already exists", () => {
    expect(
      classifyRefundReprise({
        transactions: [depositOnline],
        invoice: { totalInclVat: 10.5, creditNotes: [{ totalInclVat: 10.5 }] },
      }),
    ).toBe("REFUND_ONLY");
  });

  it("does nothing when both halves are already complete", () => {
    expect(
      classifyRefundReprise({
        transactions: fullyRefunded,
        invoice: { totalInclVat: 10.5, creditNotes: [{ totalInclVat: 10.5 }] },
      }),
    ).toBe("NOTHING_TO_DO");
  });

  it("treats two old partial notes totalling the invoice as nothing left to credit", () => {
    expect(
      classifyRefundReprise({
        transactions: fullyRefunded,
        invoice: { totalInclVat: 10.5, creditNotes: [{ totalInclVat: 5.25 }, { totalInclVat: 5.25 }] },
      }),
    ).toBe("NOTHING_TO_DO");
  });

  it("sends an inconsistent ledger to reconciliation instead of moving money", () => {
    expect(
      classifyRefundReprise({
        transactions: [
          depositOnline,
          t({ id: "r", amount: 99, method: "ONLINE", transactionType: "REFUND", paidAt: "2026-08-20T09:00:00Z" }),
        ],
        invoice: invoice21,
      }),
    ).toBe("INCONSISTENT");
  });

  it("needs both halves for an untouched paid reservation", () => {
    expect(classifyRefundReprise({ transactions: [depositOnline, balanceCash], invoice: invoice21 })).toBe("FULL");
  });
});
