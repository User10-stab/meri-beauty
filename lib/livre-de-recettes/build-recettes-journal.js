import { roundMoney, calculateVatTotals } from "@/lib/tax-policy";
import { categoryForPayment, PAYMENT_CATEGORY_LABELS } from "@/lib/payments/payment-category";
import {
  METHOD_LABELS,
  RECETTES_METHODS,
  RECETTES_CATEGORIES,
  RECETTES_CATEGORY_LABELS,
  MAX_JOURNAL_ROWS,
} from "@/lib/livre-de-recettes/filters";

/**
 * The "livre de recettes": every payment received over an arbitrary date
 * range, one row per Transaction, across every payment method — Espèces,
 * Carte and En ligne alike — with a running cumulative balance.
 *
 * This is the complete revenue register the Livre de CAISSE structurally
 * cannot be: the cash book is one till session, CASH only, and on-till only
 * (`pieceNumber: { not: null }`), so it omits every card/online payment AND
 * the cash a non-operator takes off-till at the counter. All of those are
 * real revenue and all of them belong here — off-till cash is flagged
 * `offTill: true` so the divergence from the cash book is visible, not
 * hidden.
 *
 * Method/category/VAT bucketing follows the exact same conventions as the
 * X/Z day report (lib/cash-book/build-day-report.js): a REFUND is a
 * sign-flipped ledger event netted off its own method, not dropped;
 * `isDeleted` rows are excluded; VAT is backed out of each transaction's own
 * amount at its invoice's rate, with a null "taux inconnu" bucket for a
 * payment not yet invoiced.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client — see actions/dashboard/get-recettes-journal.js for
 * the auth-gated wrapper.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {{ from: string, to: string, fromDate: Date, toDate: Date,
 *   method: "ALL"|"CASH"|"CARD"|"ONLINE", category: "ALL"|string }} params
 */
export async function buildRecettesJournal(client, { from, to, fromDate, toDate, method, category }) {
  const found = await client.transaction.findMany({
    where: {
      paidAt: { gte: fromDate, lte: toDate },
      isDeleted: false,
      ...(method !== "ALL" ? { method } : {}),
    },
    orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    take: MAX_JOURNAL_ROWS + 1,
    include: {
      payment: {
        include: {
          invoice: { select: { number: true, vatRate: true } },
          order: { select: { orderNumber: true, user: { select: { fullName: true, email: true } } } },
          appointment: {
            select: {
              user: { select: { fullName: true, email: true } },
              staffService: { select: { service: { select: { name: true } } } },
            },
          },
          workshopReservation: {
            select: {
              customer: { select: { fullName: true, email: true } },
              session: { select: { workshop: { select: { title: true, type: true } } } },
            },
          },
          formationReservation: {
            select: {
              customer: { select: { fullName: true, email: true } },
              session: { select: { formation: { select: { title: true } } } },
            },
          },
        },
      },
    },
  });

  const truncated = found.length > MAX_JOURNAL_ROWS;
  const transactions = truncated ? found.slice(0, MAX_JOURNAL_ROWS) : found;

  const byMethod = Object.fromEntries(RECETTES_METHODS.map((m) => [m, { net: 0, refunded: 0 }]));
  const byCategory = {};
  const byVatRate = new Map();
  let grossInflow = 0;
  let refundTotal = 0;
  let running = 0;

  const rows = [];

  for (const transaction of transactions) {
    const catCode = categoryForPayment(transaction.payment) ?? "OTHER";
    // The polymorphic Payment has no clean Prisma path to its category, so
    // this filter is applied in memory — same reason build-day-report walks
    // the relation in JS rather than in the query.
    if (category !== "ALL" && catCode !== category) continue;

    const amount = Number(transaction.amount);
    const isRefund = transaction.transactionType === "REFUND";
    const sign = isRefund ? -1 : 1;
    const signed = roundMoney(sign * amount);

    running = roundMoney(running + signed);

    if (isRefund) refundTotal = roundMoney(refundTotal + amount);
    else grossInflow = roundMoney(grossInflow + amount);

    if (byMethod[transaction.method]) {
      if (isRefund) {
        byMethod[transaction.method].refunded = roundMoney(byMethod[transaction.method].refunded + amount);
        byMethod[transaction.method].net = roundMoney(byMethod[transaction.method].net - amount);
      } else {
        byMethod[transaction.method].net = roundMoney(byMethod[transaction.method].net + amount);
      }
    }

    byCategory[catCode] = roundMoney((byCategory[catCode] ?? 0) + signed);

    const vatRate =
      transaction.payment?.invoice?.vatRate != null ? Number(transaction.payment.invoice.vatRate) : null;

    let amountHt = null;
    let amountVat = null;
    if (vatRate != null) {
      const totals = calculateVatTotals(amount, vatRate);
      amountHt = totals.totalExclVat;
      amountVat = totals.vatAmount;
    }
    addVatBucket(byVatRate, vatRate, amount, sign);

    const customer = customerForPayment(transaction.payment);

    rows.push({
      id: transaction.id,
      paidAt: transaction.paidAt,
      pieceNumber: transaction.pieceNumber ?? null,
      reference:
        transaction.manualReference ??
        transaction.payment?.invoice?.number ??
        transaction.stripePaymentIntentId ??
        null,
      customerName: customer?.fullName ?? null,
      customerEmail: customer?.email ?? null,
      category: catCode,
      categoryLabel: RECETTES_CATEGORY_LABELS[catCode] ?? catCode,
      label: labelForPayment(transaction.payment, { isRefund }),
      method: transaction.method,
      methodLabel: METHOD_LABELS[transaction.method] ?? transaction.method,
      transactionType: transaction.transactionType,
      isRefund,
      // Cash taken by a non-operator settles off-till: still real revenue,
      // but never in the drawer's own book. `cashSessionId` is the tell.
      offTill: transaction.method === "CASH" && transaction.cashSessionId == null,
      amountTtc: amount,
      amountHt,
      amountVat,
      vatRate,
      signedAmount: signed,
      runningTotal: running,
    });
  }

  return {
    filters: {
      from,
      to,
      method,
      category,
      methodLabel: method === "ALL" ? "Tous les moyens" : METHOD_LABELS[method] ?? method,
      categoryLabel: category === "ALL" ? "Toutes les catégories" : RECETTES_CATEGORY_LABELS[category] ?? category,
    },
    generatedAt: new Date(),
    truncated,
    rows,
    summary: {
      count: rows.length,
      total: roundMoney(grossInflow - refundTotal),
      grossInflow,
      refundTotal,
      byMethod: RECETTES_METHODS.map((m) => ({
        method: m,
        label: METHOD_LABELS[m] ?? m,
        net: byMethod[m].net,
        refunded: byMethod[m].refunded,
      })),
      byCategory: RECETTES_CATEGORIES.concat("OTHER")
        .filter((c) => byCategory[c] != null)
        .map((c) => ({
          category: c,
          label: RECETTES_CATEGORY_LABELS[c] ?? c,
          net: byCategory[c],
        })),
      byVatRate: [...byVatRate.values()].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)),
    },
  };
}

function customerForPayment(payment) {
  if (!payment) return null;
  return (
    payment.order?.user ??
    payment.appointment?.user ??
    payment.workshopReservation?.customer ??
    payment.formationReservation?.customer ??
    null
  );
}

function labelForPayment(payment, { isRefund }) {
  const prefix = isRefund ? "Remboursement — " : "";
  if (!payment) return `${prefix}Vente`;
  if (payment.order) return `${prefix}Vente produits — commande n°${payment.order.orderNumber}`;
  if (payment.appointment) {
    const service = payment.appointment.staffService?.service?.name;
    return `${prefix}Rendez-vous${service ? ` — ${service}` : ""}`;
  }
  if (payment.workshopReservation) {
    const workshop = payment.workshopReservation.session?.workshop;
    const noun = workshop?.type === "EVENT" ? "Événement" : "Atelier";
    return `${prefix}${noun}${workshop?.title ? ` — ${workshop.title}` : ""}`;
  }
  if (payment.formationReservation) {
    const title = payment.formationReservation.session?.formation?.title;
    return `${prefix}Formation${title ? ` — ${title}` : ""}`;
  }
  return `${prefix}Vente`;
}

/**
 * VAT backed out of each transaction's own amount at its invoice's rate —
 * identical arithmetic to build-day-report's addVatBucket. A transaction
 * with no invoice yet falls into a null "rate unknown" bucket rather than
 * being dropped.
 */
function addVatBucket(byVatRate, rate, amount, sign) {
  const key = rate == null ? "unknown" : rate;
  const existing = byVatRate.get(key) ?? { rate, netAmount: 0, vatAmount: 0, grossAmount: 0 };
  if (rate == null) {
    existing.grossAmount = roundMoney(existing.grossAmount + sign * amount);
  } else {
    const totals = calculateVatTotals(amount, rate);
    existing.netAmount = roundMoney(existing.netAmount + sign * totals.totalExclVat);
    existing.vatAmount = roundMoney(existing.vatAmount + sign * totals.vatAmount);
    existing.grossAmount = roundMoney(existing.grossAmount + sign * totals.totalInclVat);
  }
  byVatRate.set(key, existing);
}
